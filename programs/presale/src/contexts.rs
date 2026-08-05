use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::constants::*;
use crate::errors::PresaleError;
use crate::state::{PresaleState, StakePool, UserStake, UserVesting};

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: PDA signer validated in instruction.
    pub mint_authority: AccountInfo<'info>,

    /// CHECK: Admin ATA for mint; created in instruction when missing.
    #[account(mut)]
    pub admin_token_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Metaplex metadata PDA for this mint, validated in instruction.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex token metadata program account, validated in instruction.
    pub metadata_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct InitializePresale<'info> {
    #[account(init, payer = admin, space = 8 + PresaleState::INIT_SPACE, seeds = [CONFIG_SEED, admin.key().as_ref()], bump)]
    pub state: Account<'info, PresaleState>,

    pub mint: Account<'info, Mint>,

    #[account(init, payer = admin, seeds = [TOKEN_VAULT_SEED, state.key().as_ref()], bump, token::mint = mint, token::authority = vault_pda)]
    pub token_vault: Account<'info, TokenAccount>,

    /// CHECK: PDA signer.
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    /// CHECK: SOL vault PDA owned by system program.
    #[account(init, payer = admin, space = 0, owner = anchor_lang::system_program::ID, seeds = [SOL_VAULT_SEED, state.key().as_ref()], bump)]
    pub sol_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Treasury destination.
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut, seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, constraint = admin_token_account.owner == admin.key() @ PresaleError::Unauthorized, constraint = admin_token_account.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub admin_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [TOKEN_VAULT_SEED, state.key().as_ref()], bump = state.token_vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BuyTokens<'info> {
    #[account(mut, seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut, seeds = [SOL_VAULT_SEED, state.key().as_ref()], bump = state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [TOKEN_VAULT_SEED, state.key().as_ref()], bump = state.token_vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA signer with distinct seed to avoid collision
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(init_if_needed, payer = buyer, space = 8 + UserVesting::INIT_SPACE, seeds = [VESTING_SEED, buyer.key().as_ref()], bump)]
    pub vesting: Account<'info, UserVesting>,

    /// CHECK: Validated in instruction when `referrer` is provided.
    #[account(mut)]
    pub referrer_token_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut, seeds = [VESTING_SEED, user.key().as_ref()], bump = vesting.bump)]
    pub vesting: Account<'info, UserVesting>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [TOKEN_VAULT_SEED, state.key().as_ref()], bump = state.token_vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA signer
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut, seeds = [VESTING_SEED, user.key().as_ref()], bump = vesting.bump)]
    pub vesting: Account<'info, UserVesting>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [SOL_VAULT_SEED, state.key().as_ref()], bump = state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(mut, seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawFunds<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut, seeds = [SOL_VAULT_SEED, state.key().as_ref()], bump = state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,

    /// CHECK: Treasury
    #[account(mut, address = state.treasury)]
    pub treasury: AccountInfo<'info>,

    #[account(mut, address = state.admin)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [TOKEN_VAULT_SEED, state.key().as_ref()], bump = state.token_vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA signer
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(init_if_needed, payer = admin, associated_token::mint = mint, associated_token::authority = admin)]
    pub admin_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeStaking<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Account<'info, PresaleState>,

    #[account(init, payer = admin, space = 8 + StakePool::INIT_SPACE, seeds = [STAKE_POOL_SEED, state.key().as_ref()], bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(init, payer = admin, seeds = [STAKE_VAULT_SEED, state.key().as_ref()], bump, token::mint = mint, token::authority = vault_pda)]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(init, payer = admin, seeds = [REWARD_VAULT_SEED, state.key().as_ref()], bump, token::mint = mint, token::authority = vault_pda)]
    pub reward_vault: Account<'info, TokenAccount>,

    /// CHECK: PDA signer
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundRewardVault<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Box<Account<'info, PresaleState>>,

    #[account(mut, seeds = [STAKE_POOL_SEED, state.key().as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, StakePool>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, constraint = admin_token_account.owner == admin.key() @ PresaleError::Unauthorized, constraint = admin_token_account.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub admin_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [REWARD_VAULT_SEED, state.key().as_ref()], bump, constraint = reward_vault.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Box<Account<'info, PresaleState>>,

    #[account(mut, seeds = [STAKE_POOL_SEED, state.key().as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, StakePool>>,

    #[account(init_if_needed, payer = user, space = 8 + UserStake::INIT_SPACE, seeds = [USER_STAKE_SEED, user.key().as_ref()], bump)]
    pub user_stake: Box<Account<'info, UserStake>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, seeds = [STAKE_VAULT_SEED, state.key().as_ref()], bump, constraint = stake_vault.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub stake_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = user_token.owner == user.key() @ PresaleError::Unauthorized, constraint = user_token.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub user_token: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Box<Account<'info, PresaleState>>,

    #[account(mut, seeds = [STAKE_POOL_SEED, state.key().as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, StakePool>>,

    #[account(mut, seeds = [USER_STAKE_SEED, user.key().as_ref()], bump = user_stake.bump)]
    pub user_stake: Box<Account<'info, UserStake>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, seeds = [STAKE_VAULT_SEED, state.key().as_ref()], bump)]
    pub stake_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [REWARD_VAULT_SEED, state.key().as_ref()], bump)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA signer
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(mut)]
    pub user_token: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(seeds = [CONFIG_SEED, state.admin.as_ref()], bump = state.bump)]
    pub state: Box<Account<'info, PresaleState>>,

    #[account(mut, seeds = [STAKE_POOL_SEED, state.key().as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, StakePool>>,

    #[account(mut, seeds = [USER_STAKE_SEED, user.key().as_ref()], bump = user_stake.bump)]
    pub user_stake: Box<Account<'info, UserStake>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, seeds = [REWARD_VAULT_SEED, state.key().as_ref()], bump, constraint = reward_vault.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA signer
    #[account(seeds = [VAULT_AUTHORITY_SEED, state.key().as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(mut, constraint = user_token.owner == user.key() @ PresaleError::Unauthorized, constraint = user_token.mint == mint.key() @ PresaleError::InvalidReferralMint)]
    pub user_token: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
