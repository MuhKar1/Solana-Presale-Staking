use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TransferChecked, transfer_checked};

use crate::constants::*;
use crate::contexts::{ClaimRewards, FundRewardVault, InitializeStaking, Stake, Unstake};
use crate::errors::PresaleError;
use crate::events::{RewardVaultFunded, RewardsClaimed, Staked, StakingInitialized, Unstaked};
use crate::utils::{ensure_staking_allowed, update_pool};

pub fn initialize_staking(
    ctx: Context<InitializeStaking>,
    reward_rate_per_second: u64,
) -> Result<()> {
    let state = &ctx.accounts.state;
    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);
    require!(
        reward_rate_per_second <= MAX_REWARD_RATE_PER_SECOND,
        PresaleError::InvalidRewardRate
    );

    let clock = Clock::get()?;

    let pool = &mut ctx.accounts.pool;
    pool.reward_rate_per_second = reward_rate_per_second;
    pool.last_update_time = clock.unix_timestamp;
    pool.accrued_per_share = 0;
    pool.total_staked = 0;
    pool.remaining_rewards = 0;
    pool.bump = ctx.bumps.pool;

    emit!(StakingInitialized {
        admin: ctx.accounts.admin.key(),
        reward_rate_per_second,
    });

    Ok(())
}

pub fn fund_reward_vault(ctx: Context<FundRewardVault>, amount: u64) -> Result<()> {
    let state = &ctx.accounts.state;
    require_keys_eq!(ctx.accounts.admin.key(), state.admin, PresaleError::Unauthorized);
    require!(amount > 0, PresaleError::InvalidTokenAmount);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.admin_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.remaining_rewards = pool
        .remaining_rewards
        .checked_add(amount)
        .ok_or(PresaleError::MathOverflow)?;

    ctx.accounts.reward_vault.reload()?;

    emit!(RewardVaultFunded {
        admin: ctx.accounts.admin.key(),
        amount,
    });

    Ok(())
}

pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, PresaleError::InvalidTokenAmount);

    let state = &ctx.accounts.state;
    let clock = Clock::get()?;
    ensure_staking_allowed(state, clock.unix_timestamp)?;

    let pool = &mut ctx.accounts.pool;
    let user_stake = &mut ctx.accounts.user_stake;

    update_pool(pool, clock.unix_timestamp)?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.stake_vault.reload()?;

    user_stake.amount = user_stake
        .amount
        .checked_add(amount)
        .ok_or(PresaleError::MathOverflow)?;
    pool.total_staked = pool
        .total_staked
        .checked_add(amount)
        .ok_or(PresaleError::MathOverflow)?;

    user_stake.reward_debt = (user_stake.amount as u128 * pool.accrued_per_share) / PRECISION;
    user_stake.user = ctx.accounts.user.key();
    user_stake.bump = ctx.bumps.user_stake;

    emit!(Staked {
        user: ctx.accounts.user.key(),
        amount,
    });

    Ok(())
}

pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, PresaleError::InvalidTokenAmount);

    let state = &ctx.accounts.state;
    let clock = Clock::get()?;
    ensure_staking_allowed(state, clock.unix_timestamp)?;

    require_keys_eq!(
        ctx.accounts.stake_vault.mint,
        ctx.accounts.mint.key(),
        PresaleError::InvalidReferralMint
    );
    require_keys_eq!(
        ctx.accounts.reward_vault.mint,
        ctx.accounts.mint.key(),
        PresaleError::InvalidReferralMint
    );
    require_keys_eq!(
        ctx.accounts.user_token.owner,
        ctx.accounts.user.key(),
        PresaleError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.user_token.mint,
        ctx.accounts.mint.key(),
        PresaleError::InvalidReferralMint
    );
    require_keys_eq!(
        ctx.accounts.stake_vault.owner,
        ctx.accounts.vault_pda.key(),
        PresaleError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.reward_vault.owner,
        ctx.accounts.vault_pda.key(),
        PresaleError::Unauthorized
    );

    let pool = &mut ctx.accounts.pool;
    let user_stake = &mut ctx.accounts.user_stake;

    update_pool(pool, clock.unix_timestamp)?;

    let pending = ((user_stake.amount as u128 * pool.accrued_per_share / PRECISION)
        .checked_sub(user_stake.reward_debt)
        .ok_or(PresaleError::MathOverflow)?) as u64;

    let state_key = ctx.accounts.state.key();
    let vault_seeds = &[VAULT_AUTHORITY_SEED, state_key.as_ref(), &[ctx.bumps.vault_pda]];

    if pending > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.vault_pda.to_account_info(),
                },
                &[&vault_seeds[..]],
            ),
            pending,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.reward_vault.reload()?;
    }

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: ctx.accounts.vault_pda.to_account_info(),
            },
            &[&vault_seeds[..]],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.stake_vault.reload()?;

    user_stake.amount = user_stake
        .amount
        .checked_sub(amount)
        .ok_or(PresaleError::MathOverflow)?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(amount)
        .ok_or(PresaleError::MathOverflow)?;

    user_stake.reward_debt = (user_stake.amount as u128 * pool.accrued_per_share) / PRECISION;

    emit!(Unstaked {
        user: ctx.accounts.user.key(),
        amount,
        rewards_claimed: pending,
    });

    Ok(())
}

pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let state = &ctx.accounts.state;
    let clock = Clock::get()?;
    ensure_staking_allowed(state, clock.unix_timestamp)?;

    let pool = &mut ctx.accounts.pool;
    let user_stake = &mut ctx.accounts.user_stake;

    update_pool(pool, clock.unix_timestamp)?;

    let pending = ((user_stake.amount as u128 * pool.accrued_per_share / PRECISION)
        .checked_sub(user_stake.reward_debt)
        .ok_or(PresaleError::MathOverflow)?) as u64;

    require!(pending > 0, PresaleError::NothingToClaim);

    user_stake.reward_debt = (user_stake.amount as u128 * pool.accrued_per_share) / PRECISION;

    let state_key = ctx.accounts.state.key();
    let reward_seeds = &[VAULT_AUTHORITY_SEED, state_key.as_ref(), &[ctx.bumps.vault_pda]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: ctx.accounts.vault_pda.to_account_info(),
            },
            &[&reward_seeds[..]],
        ),
        pending,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.reward_vault.reload()?;

    emit!(RewardsClaimed {
        user: ctx.accounts.user.key(),
        amount: pending,
    });

    Ok(())
}
