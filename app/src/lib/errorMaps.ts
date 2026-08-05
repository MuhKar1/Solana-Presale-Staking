const FRIENDLY_ERROR_MAP: Record<string, string> = {
  PresaleInactive: "The presale is currently paused or not active.",
  WrongTiming: "This action is not available at the current time window.",
  HardCapReached: "The presale hard cap has already been reached.",
  SoldOut: "All sale tokens are sold out.",
  MathOverflow: "The program rejected this action because the amount was out of range.",
  WalletCapExceeded: "This purchase would exceed your wallet contribution limit.",
  StageSoldOut: "The current sale stage is sold out.",
  SelfReferral: "You cannot use your own wallet as a referral.",
  InvalidReferralAccount: "The referral token account is invalid for the selected wallet.",
  InvalidReferralMint: "The provided token account does not match the presale mint.",
  PresaleStillActive: "This action is only available after the presale has ended.",
  InvalidTime: "One or more time values are invalid.",
  BelowMinClaim: "Claim is below minimum threshold right now.",
  CliffNotPassed: "Tokens are still locked. The vesting cliff has not passed yet.",
  SoftCapNotMet: "The soft cap has not been reached, so this action is unavailable.",
  SoftCapMet: "The soft cap was met, so refunds are not available.",
  InvalidCaps: "Soft cap and hard cap settings are invalid.",
  InvalidVesting: "Vesting duration or cliff values are invalid.",
  InvalidReferralRate: "Referral bonus rate is outside allowed range.",
  InvalidPrice: "A stage price is invalid.",
  InvalidTokenAmount: "The token amount must be greater than zero.",
  InvalidMaxContribution: "The max contribution amount is invalid.",
  InvalidStages: "Stage configuration is invalid.",
  StageTokenMismatch: "Stage token totals do not match total tokens for sale.",
  PresaleAlreadyStarted: "This setup action can only be done before the presale starts.",
  NothingToWithdraw: "There is nothing available to withdraw yet.",
  NothingToRefund: "No refundable contribution was found for this wallet.",
  NothingToClaim: "There is currently nothing claimable for this wallet.",
  VestingNotComplete: "Vesting is not complete yet.",
  AdminActionsLocked: "Admin actions are currently time-locked.",
  Unauthorized: "This wallet is not authorized for the selected admin action.",
  InvalidRewardRate: "Reward rate is too high or invalid.",
};

export function humanizeError(err: unknown): string {
  const asAny = err as any;
  const fromAnchorName = asAny?.error?.errorCode?.code;
  if (fromAnchorName && FRIENDLY_ERROR_MAP[fromAnchorName]) {
    return FRIENDLY_ERROR_MAP[fromAnchorName];
  }

  const msg: string =
    asAny?.error?.errorMessage ||
    asAny?.message ||
    asAny?.toString?.() ||
    "Unknown error";

  for (const [code, text] of Object.entries(FRIENDLY_ERROR_MAP)) {
    if (msg.includes(code)) {
      return text;
    }
  }

  if (msg.includes("User rejected")) {
    return "Transaction was cancelled in your wallet.";
  }

  if (msg.includes("Blockhash not found")) {
    return "Network was busy. Please retry in a few seconds.";
  }

  return `Action failed: ${msg}`;
}
