use anchor_lang::prelude::*;

pub mod admin;
pub mod constants;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod investor;
pub mod staking;
pub mod state;
pub mod utils;

pub use contexts::*;
pub use errors::*;
pub use events::*;
pub use state::*;

declare_id!("BMDPz1QgcibK13BmWDDF7tZCSmJbrqkd9Ek1nq9NkuFa");

#[program]
pub mod presale {
    use super::*;

    pub fn create_muhoro_token(
        ctx: Context<CreateMuhoroToken>,
        decimals: u8,
        initial_supply: u64,
        creator: Option<Pubkey>,
    ) -> Result<()> {
        admin::create_muhoro_token(ctx, decimals, initial_supply, creator)
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
        stages: Vec<PresaleStage>,
    ) -> Result<()> {
        admin::initialize_presale(
            ctx,
            soft_cap,
            hard_cap,
            max_contribution,
            tokens_for_sale,
            start_time,
            end_time,
            vesting_duration,
            vesting_cliff,
            min_claim_amount,
            referral_bonus_bps,
            stages,
        )
    }

    pub fn fund_presale_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        admin::fund_presale_vault(ctx, amount)
    }

    pub fn buy_tokens<'info>(
        ctx: Context<'_, '_, 'info, 'info, BuyTokens<'info>>,
        sol_amount: u64,
        referrer: Option<Pubkey>,
    ) -> Result<()> {
        investor::buy_tokens(ctx, sol_amount, referrer)
    }

    pub fn claim_vested(ctx: Context<ClaimVested>) -> Result<()> {
        investor::claim_vested(ctx)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        investor::claim_refund(ctx)
    }

    pub fn toggle_pause(ctx: Context<TogglePause>, paused: bool) -> Result<()> {
        admin::toggle_pause(ctx, paused)
    }

    pub fn finalize_presale(ctx: Context<AdminOnly>) -> Result<()> {
        admin::finalize_presale(ctx)
    }

    pub fn withdraw_funds(ctx: Context<WithdrawFunds>) -> Result<()> {
        admin::withdraw_funds(ctx)
    }

    pub fn withdraw_unsold(ctx: Context<AdminWithdraw>) -> Result<()> {
        admin::withdraw_unsold(ctx)
    }

    pub fn initialize_staking(
        ctx: Context<InitializeStaking>,
        reward_rate_per_second: u64,
    ) -> Result<()> {
        staking::initialize_staking(ctx, reward_rate_per_second)
    }

    pub fn fund_reward_vault(ctx: Context<FundRewardVault>, amount: u64) -> Result<()> {
        staking::fund_reward_vault(ctx, amount)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        staking::stake(ctx, amount)
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        staking::unstake(ctx, amount)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        staking::claim_rewards(ctx)
    }

    pub fn set_admin_actions_lock(ctx: Context<AdminOnly>, unlock_timestamp: i64) -> Result<()> {
        admin::set_admin_actions_lock(ctx, unlock_timestamp)
    }
}
