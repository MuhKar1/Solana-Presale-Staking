use anchor_lang::prelude::*;

use crate::constants::PRECISION;
use crate::errors::PresaleError;
use crate::state::{PresaleState, StakePool};

pub fn update_pool(pool: &mut StakePool, timestamp: i64) -> Result<()> {
    if timestamp <= pool.last_update_time {
        return Ok(());
    }

    let delta = (timestamp - pool.last_update_time) as u64;
    let scheduled_rewards = delta
        .checked_mul(pool.reward_rate_per_second)
        .ok_or(PresaleError::MathOverflow)?;

    if pool.total_staked > 0 && pool.remaining_rewards > 0 {
        let distributable = scheduled_rewards.min(pool.remaining_rewards);
        let per_share_increase = ((distributable as u128) * PRECISION) / (pool.total_staked as u128);
        pool.accrued_per_share = pool
            .accrued_per_share
            .checked_add(per_share_increase)
            .ok_or(PresaleError::MathOverflow)?;
        pool.remaining_rewards = pool
            .remaining_rewards
            .checked_sub(distributable)
            .ok_or(PresaleError::MathOverflow)?;
    }

    pool.last_update_time = timestamp;
    Ok(())
}

pub fn ensure_staking_allowed(state: &PresaleState, timestamp: i64) -> Result<()> {
    require!(!state.is_paused, PresaleError::PresaleInactive);
    require!(!state.is_active && timestamp > state.end_time, PresaleError::PresaleStillActive);
    require!(state.total_raised_lamports >= state.soft_cap_lamports, PresaleError::SoftCapNotMet);
    Ok(())
}
