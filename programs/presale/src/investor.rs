use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{Mint, TokenInterface, TransferChecked, transfer_checked},
};

use crate::constants::*;
use crate::contexts::{BuyTokens, ClaimRefund, ClaimVested};
use crate::errors::PresaleError;
use crate::events::{ReferralBonus, RefundClaimed, TokensClaimed, TokensPurchased};

pub fn buy_tokens<'info>(
    ctx: Context<'_, '_, 'info, 'info, BuyTokens<'info>>,
    sol_amount: u64,
    referrer: Option<Pubkey>,
) -> Result<()> {
    let state = &mut ctx.accounts.state;
    let clock = Clock::get()?;

    require!(state.is_active && !state.is_paused, PresaleError::PresaleInactive);
    require!(
        clock.unix_timestamp >= state.start_time && clock.unix_timestamp <= state.end_time,
        PresaleError::WrongTiming
    );

    let vesting = &mut ctx.accounts.vesting;

    let stage_idx = state.current_stage_index as usize;
    require!(stage_idx < state.stages.len(), PresaleError::SoldOut);

    let token_unit = 10u64
        .checked_pow(ctx.accounts.mint.decimals as u32)
        .ok_or(PresaleError::MathOverflow)?;
    let mut remaining_sol = sol_amount;
    let mut tokens = 0u64;
    let mut idx = stage_idx;

    while remaining_sol > 0 && idx < state.stages.len() {
        let stage = &mut state.stages[idx];
        let stage_remaining = stage
            .tokens_available
            .checked_sub(stage.tokens_sold_in_stage)
            .ok_or(PresaleError::MathOverflow)?;

        if stage_remaining == 0 {
            idx = idx.checked_add(1).ok_or(PresaleError::MathOverflow)?;
            continue;
        }

        let affordable = remaining_sol
            .checked_mul(token_unit)
            .ok_or(PresaleError::MathOverflow)?
            .checked_div(stage.price_per_token)
            .ok_or(PresaleError::MathOverflow)?;

        if affordable == 0 {
            break;
        }

        let buy_in_stage = affordable.min(stage_remaining);

        let sol_used = buy_in_stage
            .checked_mul(stage.price_per_token)
            .ok_or(PresaleError::MathOverflow)?
            .checked_div(token_unit)
            .ok_or(PresaleError::MathOverflow)?;

        stage.tokens_sold_in_stage = stage
            .tokens_sold_in_stage
            .checked_add(buy_in_stage)
            .ok_or(PresaleError::MathOverflow)?;
        tokens = tokens.checked_add(buy_in_stage).ok_or(PresaleError::MathOverflow)?;
        remaining_sol = remaining_sol
            .checked_sub(sol_used)
            .ok_or(PresaleError::MathOverflow)?;

        if stage.tokens_sold_in_stage >= stage.tokens_available {
            idx = idx.checked_add(1).ok_or(PresaleError::MathOverflow)?;
        }
    }

    require!(tokens > 0, PresaleError::InvalidTokenAmount);
    let sol_used = sol_amount
        .checked_sub(remaining_sol)
        .ok_or(PresaleError::MathOverflow)?;
    require!(sol_used > 0, PresaleError::InvalidTokenAmount);

    let new_contrib = vesting
        .contributed_lamports
        .checked_add(sol_used)
        .ok_or(PresaleError::MathOverflow)?;
    require!(
        new_contrib <= state.max_contribution_lamports,
        PresaleError::WalletCapExceeded
    );

    let new_total = state
        .total_raised_lamports
        .checked_add(sol_used)
        .ok_or(PresaleError::MathOverflow)?;
    require!(new_total <= state.hard_cap_lamports, PresaleError::HardCapReached);

    state.current_stage_index = idx.min(state.stages.len().saturating_sub(1)) as u8;

    state.tokens_sold = state
        .tokens_sold
        .checked_add(tokens)
        .ok_or(PresaleError::MathOverflow)?;
    state.total_raised_lamports = new_total;

    if vesting.total_locked == 0 {
        vesting.start_time = state.end_time;
    }
    vesting.total_locked = vesting
        .total_locked
        .checked_add(tokens)
        .ok_or(PresaleError::MathOverflow)?;
    vesting.contributed_lamports = new_contrib;
    vesting.user = ctx.accounts.buyer.key();
    vesting.bump = ctx.bumps.vesting;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        sol_used,
    )?;

    if let Some(ref_key) = referrer {
        let ref_ata_info = ctx.accounts.referrer_token_account.as_ref();
        require!(ref_key != ctx.accounts.buyer.key(), PresaleError::SelfReferral);

        require_keys_eq!(
            *ref_ata_info.owner,
            ctx.accounts.token_program.key(),
            PresaleError::InvalidReferralAccount
        );

        let expected_ref_ata = get_associated_token_address_with_program_id(
            &ref_key,
            &state.token_mint,
            &ctx.accounts.token_program.key(),
        );
        require_keys_eq!(
            ref_ata_info.key(),
            expected_ref_ata,
            PresaleError::InvalidReferralAccount
        );

        let bonus = tokens
            .checked_mul(state.referral_bonus_bps as u64)
            .ok_or(PresaleError::MathOverflow)?
            .checked_div(10000)
            .ok_or(PresaleError::MathOverflow)?;

        if bonus > 0 {
            state.total_referral_bonuses = state
                .total_referral_bonuses
                .checked_add(bonus)
                .ok_or(PresaleError::MathOverflow)?;

            let state_key = state.key();
            let seeds = &[VAULT_AUTHORITY_SEED, state_key.as_ref(), &[ctx.bumps.vault_pda]];

            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ref_ata_info.to_account_info(),
                        authority: ctx.accounts.vault_pda.to_account_info(),
                    },
                    &[&seeds[..]],
                ),
                bonus,
                ctx.accounts.mint.decimals,
            )?;

            ctx.accounts.vault.reload()?;

            emit!(ReferralBonus {
                referrer: ref_key,
                buyer: ctx.accounts.buyer.key(),
                bonus_amount: bonus,
            });
        }
    }

    emit!(TokensPurchased {
        buyer: ctx.accounts.buyer.key(),
        amount_sol: sol_used,
        tokens_received: tokens,
        stage: state.current_stage_index,
    });

    Ok(())
}

pub fn claim_vested(ctx: Context<ClaimVested>) -> Result<()> {
    let state = &ctx.accounts.state;
    let vesting = &mut ctx.accounts.vesting;
    let clock = Clock::get()?;

    require!(!state.is_paused, PresaleError::PresaleInactive);
    require!(
        state.total_raised_lamports >= state.soft_cap_lamports,
        PresaleError::SoftCapNotMet
    );

    let effective_start = vesting.start_time + state.vesting_cliff;
    require!(clock.unix_timestamp >= effective_start, PresaleError::CliffNotPassed);

    let elapsed = (clock.unix_timestamp - effective_start) as u64;
    let vested = if elapsed >= state.vesting_duration as u64 {
        vesting.total_locked
    } else {
        vesting
            .total_locked
            .checked_mul(elapsed)
            .ok_or(PresaleError::MathOverflow)?
            .checked_div(state.vesting_duration as u64)
            .ok_or(PresaleError::MathOverflow)?
    };

    let releasable = vested
        .checked_sub(vesting.already_claimed)
        .ok_or(PresaleError::MathOverflow)?;
    require!(releasable > 0, PresaleError::NothingToClaim);

    if releasable < state.min_claim_amount {
        require!(vested == vesting.total_locked, PresaleError::BelowMinClaim);
    }

    vesting.already_claimed = vesting
        .already_claimed
        .checked_add(releasable)
        .ok_or(PresaleError::MathOverflow)?;

    let state_key = state.key();
    let seeds = &[VAULT_AUTHORITY_SEED, state_key.as_ref(), &[ctx.bumps.vault_pda]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_pda.to_account_info(),
            },
            &[&seeds[..]],
        ),
        releasable,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.vault.reload()?;

    emit!(TokensClaimed {
        user: ctx.accounts.user.key(),
        amount: releasable,
    });

    Ok(())
}

pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let state = &ctx.accounts.state;
    let vesting = &mut ctx.accounts.vesting;
    let clock = Clock::get()?;

    require!(clock.unix_timestamp > state.end_time, PresaleError::PresaleStillActive);
    require!(
        state.total_raised_lamports < state.soft_cap_lamports,
        PresaleError::SoftCapMet
    );

    let amount = vesting.contributed_lamports;
    require!(amount > 0, PresaleError::NothingToRefund);

    vesting.contributed_lamports = 0;

    let state_key = state.key();
    let seeds = &[SOL_VAULT_SEED, state_key.as_ref(), &[state.sol_vault_bump]];

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.sol_vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            &[&seeds[..]],
        ),
        amount,
    )?;

    emit!(RefundClaimed {
        user: ctx.accounts.user.key(),
        amount_sol: amount,
    });

    Ok(())
}
