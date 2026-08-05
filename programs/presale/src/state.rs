use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PresaleStage {
    pub price_per_token: u64,
    pub tokens_available: u64,
    pub tokens_sold_in_stage: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PresaleState {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub treasury: Pubkey,
    #[max_len(64)]
    pub token_name: String,
    #[max_len(16)]
    pub token_symbol: String,
    #[max_len(256)]
    pub token_image_url: String,
    #[max_len(256)]
    pub token_description: String,
    pub soft_cap_lamports: u64,
    pub hard_cap_lamports: u64,
    pub max_contribution_lamports: u64,
    pub tokens_for_sale: u64,
    pub tokens_sold: u64,
    pub total_raised_lamports: u64,
    pub total_referral_bonuses: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub vesting_duration: i64,
    pub vesting_cliff: i64,
    pub min_claim_amount: u64,
    pub referral_bonus_bps: u16,
    pub is_active: bool,
    pub is_paused: bool,
    #[max_len(5)]
    pub stages: Vec<PresaleStage>,
    pub current_stage_index: u8,
    pub bump: u8,
    pub token_vault_bump: u8,
    pub sol_vault_bump: u8,
    pub admin_actions_locked_until: i64,
}

#[account]
#[derive(InitSpace)]
pub struct UserVesting {
    pub user: Pubkey,
    pub total_locked: u64,
    pub already_claimed: u64,
    pub contributed_lamports: u64,
    pub start_time: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StakePool {
    pub reward_rate_per_second: u64,
    pub last_update_time: i64,
    pub accrued_per_share: u128,
    pub total_staked: u64,
    pub remaining_rewards: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserStake {
    pub user: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    pub bump: u8,
}
