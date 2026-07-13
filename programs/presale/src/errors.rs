use anchor_lang::prelude::*;

#[error_code]
pub enum PresaleError {
    #[msg("Presale is not active")]
    PresaleInactive,
    #[msg("Current time is outside presale window")]
    WrongTiming,
    #[msg("Hard cap has been reached")]
    HardCapReached,
    #[msg("All tokens have been sold")]
    SoldOut,
    #[msg("Mathematical overflow occurred")]
    MathOverflow,
    #[msg("Wallet contribution cap exceeded")]
    WalletCapExceeded,
    #[msg("Current stage has sold out")]
    StageSoldOut,
    #[msg("Cannot refer yourself")]
    SelfReferral,
    #[msg("Invalid referral account")]
    InvalidReferralAccount,
    #[msg("Invalid referral mint")]
    InvalidReferralMint,
    #[msg("Presale is still active")]
    PresaleStillActive,
    #[msg("Invalid time configuration")]
    InvalidTime,
    #[msg("Claim amount below minimum")]
    BelowMinClaim,
    #[msg("Vesting cliff has not passed")]
    CliffNotPassed,
    #[msg("Soft cap was not met")]
    SoftCapNotMet,
    #[msg("Soft cap has been met, no refunds")]
    SoftCapMet,
    #[msg("Invalid caps configuration")]
    InvalidCaps,
    #[msg("Invalid vesting configuration")]
    InvalidVesting,
    #[msg("Invalid referral rate")]
    InvalidReferralRate,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Invalid token amount")]
    InvalidTokenAmount,
    #[msg("Invalid max contribution")]
    InvalidMaxContribution,
    #[msg("Invalid stages configuration")]
    InvalidStages,
    #[msg("Stage token amounts don't match total")]
    StageTokenMismatch,
    #[msg("Presale has already started")]
    PresaleAlreadyStarted,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Vesting not complete")]
    VestingNotComplete,
    #[msg("Admin actions are currently locked")]
    AdminActionsLocked,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid reward rate")]
    InvalidRewardRate,
}
