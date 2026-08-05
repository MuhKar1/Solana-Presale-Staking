use anchor_lang::{
    prelude::*,
    solana_program::program_pack::Pack,
    system_program,
};
use anchor_spl::{
    associated_token,
    metadata::{
        CreateMetadataAccountsV3,
        create_metadata_accounts_v3,
        mpl_token_metadata::{
            ID as METADATA_PROGRAM_ID,
            types::DataV2,
        },
    },
    token::{
        InitializeMint2,
        MintTo,
        SetAuthority,
        TransferChecked,
        mint_to,
        initialize_mint2,
        set_authority,
        transfer_checked,
        spl_token::state::Mint,
    },
};
use spl_token::instruction::AuthorityType;

use crate::constants::*;
use crate::contexts::*;
use crate::errors::PresaleError;
use crate::events::*;
use crate::state::*;

pub fn create_token(
    ctx: Context<CreateToken>,
    decimals: u8,
    initial_supply: u64,
    _creator: Option<Pubkey>,
    name: String,
    symbol: String,
    uri: String,
    description: String,
) -> Result<()> {
    require!(name.len() <= 32, PresaleError::InvalidTokenMetadata);
    require!(symbol.len() <= 10, PresaleError::InvalidTokenMetadata);
    require!(uri.len() <= 200, PresaleError::InvalidTokenMetadata);

    let (mint_authority, bump) =
        Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], ctx.program_id);
    require_keys_eq!(ctx.accounts.mint_authority.key(), mint_authority, PresaleError::InvalidMintAuthority);

    let signer_bump = [bump];
    let signer_seeds = &[&[MINT_AUTHORITY_SEED, &signer_bump][..]];
    let mint_key = ctx.accounts.mint.key();
    let token_program_key = ctx.accounts.token_program.key();
    require_keys_eq!(ctx.accounts.metadata_program.key(), METADATA_PROGRAM_ID, PresaleError::InvalidTokenMetadata);

    let (metadata_pda, _) = Pubkey::find_program_address(
        &[b"metadata", METADATA_PROGRAM_ID.as_ref(), mint_key.as_ref()],
        &METADATA_PROGRAM_ID,
    );
    require_keys_eq!(ctx.accounts.metadata.key(), metadata_pda, PresaleError::InvalidTokenMetadata);

    // 1) Allocate a classic SPL mint account.
    let rent_lamports = Rent::get()?.minimum_balance(Mint::LEN);

    // 2) Create mint account.
    system_program::create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.admin.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        rent_lamports,
        Mint::LEN as u64,
        &token_program_key,
    )?;

    // 3) Initialize classic SPL mint.
    initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            InitializeMint2 {
                mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        decimals,
        &mint_authority,
        None,
    )?;

    // 4) Create Metaplex metadata account for wallet/indexer compatibility.
    let metadata_program_info = ctx.accounts.metadata_program.to_account_info();
    let metadata_account_info = ctx.accounts.metadata.to_account_info();
    let use_metadata_program = metadata_program_info.executable
        && metadata_program_info.key() == METADATA_PROGRAM_ID;

    if use_metadata_program {
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                metadata_program_info.clone(),
                CreateMetadataAccountsV3 {
                    metadata: metadata_account_info.clone(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.mint_authority.to_account_info(),
                    payer: ctx.accounts.admin.to_account_info(),
                    update_authority: ctx.accounts.mint_authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                signer_seeds,
            ),
            DataV2 {
                name: name.clone(),
                symbol: symbol.clone(),
                uri: uri.clone(),
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true,
            true,
            None,
        )?;
    } else {
        // Metaplex program unavailable on this validator; metadata account will not be created.
        msg!("Metaplex program not deployed; skipping on-chain metadata account creation");
    }

    emit!(TokenMetadataInitialized {
        admin: ctx.accounts.admin.key(),
        mint: mint_key,
        name,
        symbol,
        uri,
    });

    // 5) Create admin ATA if absent.
    if ctx.accounts.admin_token_account.to_account_info().lamports() == 0 {
        associated_token::create(
            CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.admin.to_account_info(),
                    associated_token: ctx.accounts.admin_token_account.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ),
        )?;
    }

    // 6) Mint initial supply, then revoke mint authority for fixed supply.
    if initial_supply > 0 {
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.admin_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            initial_supply,
        )?;
    }

    set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer_seeds,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    emit!(TokenCreated {
        admin: ctx.accounts.admin.key(),
        mint: mint_key,
        decimals,
        initial_supply,
        mint_authority_revoked: true,
    });

    if !description.is_empty() {
        msg!("Token description is stored in presale state metadata fields");
    }

    Ok(())
}

pub fn initialize_presale(
    ctx: Context<InitializePresale>,
    soft_cap: u64,
    hard_cap: u64,
    max_contribution: u64,
    tokens_for_sale: u64,
    start_time: i64,
    end_time: i64,
    vesting_duration: i64,
    vesting_cliff: i64,
    min_claim_amount: u64,
    referral_bonus_bps: u16,
    token_name: String,
    token_symbol: String,
    token_image_url: String,
    token_description: String,
    stages: Vec<PresaleStage>,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(start_time > clock.unix_timestamp, PresaleError::InvalidTime);
    require!(end_time > start_time, PresaleError::InvalidTime);
    require!(hard_cap >= soft_cap && hard_cap > 0, PresaleError::InvalidCaps);
    require!(max_contribution > 0 && max_contribution <= hard_cap, PresaleError::InvalidMaxContribution);
    require!(vesting_duration > 0, PresaleError::InvalidVesting);
    require!(vesting_cliff >= 0 && vesting_cliff <= vesting_duration, PresaleError::InvalidVesting);
    require!(referral_bonus_bps <= 2500, PresaleError::InvalidReferralRate);
    require!(!stages.is_empty() && stages.len() <= 5, PresaleError::InvalidStages);

    let mut total_stage_tokens = 0u64;
    for stage in &stages {
        require!(stage.price_per_token > 0, PresaleError::InvalidPrice);
        require!(stage.tokens_available > 0, PresaleError::InvalidTokenAmount);
        total_stage_tokens = total_stage_tokens
            .checked_add(stage.tokens_available)
            .ok_or(PresaleError::MathOverflow)?;
    }
    require_eq!(total_stage_tokens, tokens_for_sale, PresaleError::StageTokenMismatch);

    let state = &mut ctx.accounts.state;
    **state = PresaleState {
        admin: ctx.accounts.admin.key(),
        token_mint: ctx.accounts.mint.key(),
        treasury: ctx.accounts.treasury.key(),
        token_name,
        token_symbol,
        token_image_url,
        token_description,
        soft_cap_lamports: soft_cap,
        hard_cap_lamports: hard_cap,
        max_contribution_lamports: max_contribution,
        tokens_for_sale,
        tokens_sold: 0,
        total_raised_lamports: 0,
        total_referral_bonuses: 0,
        start_time,
        end_time,
        vesting_duration,
        vesting_cliff,
        min_claim_amount,
        referral_bonus_bps,
        is_active: true,
        is_paused: false,
        stages,
        current_stage_index: 0,
        bump: ctx.bumps.state,
        token_vault_bump: ctx.bumps.token_vault,
        sol_vault_bump: ctx.bumps.sol_vault,
        admin_actions_locked_until: 0,
    };

    emit!(PresaleInitialized {
        admin: state.admin,
        token_mint: state.token_mint,
        soft_cap,
        hard_cap,
        start_time,
        end_time,
    });

    Ok(())
}

pub fn fund_presale_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
    let state = &ctx.accounts.state;
    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);
    require!(Clock::get()?.unix_timestamp < state.start_time, PresaleError::PresaleAlreadyStarted);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.admin_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.vault.reload()?;

    emit!(VaultFunded {
        admin: ctx.accounts.admin.key(),
        amount,
    });

    Ok(())
}

pub fn toggle_pause(ctx: Context<TogglePause>, paused: bool) -> Result<()> {
    let state = &mut ctx.accounts.state;

    require!(
        Clock::get()?.unix_timestamp >= state.admin_actions_locked_until,
        PresaleError::AdminActionsLocked
    );

    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);

    state.is_paused = paused;

    emit!(PresalePauseToggled { is_paused: paused });

    Ok(())
}

pub fn finalize_presale(ctx: Context<AdminOnly>) -> Result<()> {
    let state = &mut ctx.accounts.state;

    require!(
        Clock::get()?.unix_timestamp >= state.admin_actions_locked_until,
        PresaleError::AdminActionsLocked
    );

    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);
    require!(Clock::get()?.unix_timestamp > state.end_time, PresaleError::PresaleStillActive);

    state.is_active = false;

    emit!(PresaleFinalized {
        total_raised: state.total_raised_lamports,
        tokens_sold: state.tokens_sold,
        soft_cap_met: state.total_raised_lamports >= state.soft_cap_lamports,
    });

    Ok(())
}

pub fn withdraw_funds(ctx: Context<WithdrawFunds>) -> Result<()> {
    let state = &ctx.accounts.state;

    require!(
        Clock::get()?.unix_timestamp >= state.admin_actions_locked_until,
        PresaleError::AdminActionsLocked
    );

    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);
    require!(Clock::get()?.unix_timestamp > state.end_time, PresaleError::PresaleStillActive);
    require!(state.total_raised_lamports >= state.soft_cap_lamports, PresaleError::SoftCapNotMet);

    let amount = ctx.accounts.sol_vault.to_account_info().lamports();
    require!(amount > 0, PresaleError::NothingToWithdraw);

    let state_key = state.key();
    let seeds = &[
        SOL_VAULT_SEED,
        state_key.as_ref(),
        &[state.sol_vault_bump],
    ];

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.sol_vault.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
            &[&seeds[..]],
        ),
        amount,
    )?;

    Ok(())
}

pub fn withdraw_unsold(ctx: Context<AdminWithdraw>) -> Result<()> {
    let state = &ctx.accounts.state;

    require!(
        Clock::get()?.unix_timestamp >= state.admin_actions_locked_until,
        PresaleError::AdminActionsLocked
    );

    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);
    require!(Clock::get()?.unix_timestamp > state.end_time, PresaleError::PresaleStillActive);

    let total_locked = state
        .tokens_sold
        .checked_add(state.total_referral_bonuses)
        .ok_or(PresaleError::MathOverflow)?;

    let withdrawable = ctx.accounts.vault.amount.saturating_sub(total_locked);
    require!(withdrawable > 0, PresaleError::NothingToWithdraw);

    let state_key = state.key();
    let seeds = &[
        VAULT_AUTHORITY_SEED,
        state_key.as_ref(),
        &[ctx.bumps.vault_pda],
    ];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.admin_ata.to_account_info(),
                authority: ctx.accounts.vault_pda.to_account_info(),
            },
            &[&seeds[..]],
        ),
        withdrawable,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.vault.reload()?;

    emit!(RemainingClaimed {
        admin: ctx.accounts.admin.key(),
        amount: withdrawable,
    });

    Ok(())
}

pub fn set_admin_actions_lock(ctx: Context<AdminOnly>, unlock_timestamp: i64) -> Result<()> {
    let state = &mut ctx.accounts.state;
    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);

    let now = Clock::get()?.unix_timestamp;
    require!(unlock_timestamp > now, PresaleError::InvalidTime);

    state.admin_actions_locked_until = unlock_timestamp;

    emit!(AdminActionsLockSet {
        admin: ctx.accounts.admin.key(),
        unlock_timestamp,
    });

    Ok(())
}
