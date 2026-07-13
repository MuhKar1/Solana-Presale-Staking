use anchor_lang::prelude::*;

#[event]
pub struct PresaleInitialized {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct VaultFunded {
    pub admin: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TokensPurchased {
    pub buyer: Pubkey,
    pub amount_sol: u64,
    pub tokens_received: u64,
    pub stage: u8,
}

#[event]
pub struct ReferralBonus {
    pub referrer: Pubkey,
    pub buyer: Pubkey,
    pub bonus_amount: u64,
}

#[event]
pub struct TokensClaimed {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RefundClaimed {
    pub user: Pubkey,
    pub amount_sol: u64,
}

#[event]
pub struct PresalePauseToggled {
    pub is_paused: bool,
}

#[event]
pub struct PresaleFinalized {
    pub total_raised: u64,
    pub tokens_sold: u64,
    pub soft_cap_met: bool,
}

#[event]
pub struct RemainingClaimed {
    pub admin: Pubkey,
    pub amount: u64,
}

#[event]
pub struct StakingInitialized {
    pub admin: Pubkey,
    pub reward_rate_per_second: u64,
}

#[event]
pub struct RewardVaultFunded {
    pub admin: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub amount: u64,
    pub rewards_claimed: u64,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AdminActionsLockSet {
    pub admin: Pubkey,
    pub unlock_timestamp: i64,
}
