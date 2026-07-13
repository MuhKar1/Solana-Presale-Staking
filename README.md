# Presale Program

## Overview

This repository contains a Solana Anchor program for a staged token presale with vesting, referral rewards, refund logic, administrative controls, and post-presale staking rewards.

The implementation is designed to support secure token distribution while preserving strict authority boundaries and predictable accounting behavior under edge conditions.

## Key Features

- Multi-stage token pricing with per-stage supply tracking
- Soft cap and hard cap enforcement
- Per-wallet contribution limits
- Vesting with configurable cliff and duration
- Referral bonuses with strict token-account validation
- Refund claims when soft cap is not met
- Administrative pause/finalize/withdraw controls
- Time-locked administrative actions
- Staking with reward-per-share accounting
- Reward-vault funding and controlled reward distribution

## Project Structure

- programs/presale/src/lib.rs
  - Program entrypoint and instruction routing
- programs/presale/src/admin.rs
  - Administrative instruction handlers and lifecycle controls
- programs/presale/src/investor.rs
  - Investor-facing flows: buy, claim vested, claim refund
- programs/presale/src/staking.rs
  - Staking initialization, funding, stake/unstake, reward claims
- programs/presale/src/contexts.rs
  - Account validation and Anchor account context definitions
- programs/presale/src/state.rs
  - On-chain state models
- programs/presale/src/errors.rs
  - Custom error codes
- programs/presale/src/events.rs
  - Program events for observability
- programs/presale/src/constants.rs
  - PDA seeds and protocol constants
- programs/presale/src/utils.rs
  - Shared helper logic for staking and reward accounting
- tests/presale.ts
  - Integration and adversarial test suite

## Security Measures Implemented

### 1) Access Control and Authorization

- Admin-gated actions require signer equality checks against persisted admin state.
- Treasury withdrawals are restricted to the configured treasury account.
- Funding and token movement paths validate account ownership and mint consistency.

### 2) PDA and Vault Safety

- Dedicated PDA seeds are used for configuration, vault authority, token vault, SOL vault, staking pool, stake vault, reward vault, and user-specific records.
- Stake pool seed includes the presale state key, preventing cross-state collisions.
- SOL vault is created as a system-owned PDA account for secure lamport transfers.

### 3) Presale Timing and Lifecycle Guards

- Presale start/end windows are enforced for purchasing.
- Finalization and certain admin actions require appropriate lifecycle state.
- Time-lock support blocks sensitive admin actions until unlock timestamp.

### 4) Economic and Arithmetic Safety

- Checked arithmetic is used for all sensitive calculations.
- Hard cap, soft cap, and per-wallet cap validations are enforced.
- Purchase logic charges only consumed SOL when traversing stage boundaries.
- Staking pool updates are bounded by remaining reward inventory.

### 5) Referral Abuse Prevention

- Self-referral is explicitly blocked.
- Referral destination must match the canonical associated token account for the provided referrer, mint, and token program.
- Referral account owner is validated against the configured token program.

### 6) Staking and Reward Integrity

- Staking is blocked unless presale completion conditions are satisfied.
- Reward debt is recomputed after stake and unstake operations.
- Pending rewards are calculated with reward-per-share precision and controlled vault signer seeds.

### 7) Input Validation

- Invalid vesting configurations are rejected.
- Invalid stage configuration and stage-token mismatches are rejected.
- Zero-amount funding and stake operations are rejected.
- Reward rate is bounded to a maximum allowed value.

## Test Coverage Summary

The integration suite in tests/presale.ts validates functional behavior and adversarial scenarios, including edge cases and abuse attempts.

### Covered Scenarios

- Rejection of invalid initialization parameters
- Prevention of self-referral and malformed referral account abuse
- Correct SOL accounting across multi-stage purchase transitions
- Enforcement of staking gating before valid presale completion
- Rejection of unauthorized reward-vault funding attempts
- Administrative authorization and timelock enforcement
- Unauthorized treasury withdrawal protection
- Zero-value staking and zero reward funding rejection
- Successful staking flow after valid presale finalization
- Rounding boundary behavior in stage traversal logic
- Reward debt correctness during partial unstake
- Strict cliff enforcement for vesting claims

### Current Test Status

Most recent run completed with all tests passing:

- 11 passing
- 0 failing

## Operational Notes

- Anchor may emit a deprecation warning related to AccountInfo realloc usage originating from macro internals.
- Node may emit a module-typeless warning for the TypeScript test file when running via ts-mocha.
- These warnings do not indicate a functional test failure.

## Build and Test

From the presale workspace root:

anchor build
anchor test

## Professional Assurance Statement

The current implementation reflects a hardened security posture for common presale and staking attack surfaces, including authority misuse, referral abuse, timing bypass, accounting drift, and reward-drain attempts. The adversarial test suite provides evidence of these controls under realistic and edge-condition execution paths.
