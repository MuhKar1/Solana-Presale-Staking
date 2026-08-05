# Solana Presale + Staking (Anchor + Next.js)

A production-oriented fullstack protocol for staged token sales, vesting, referral rewards, refunds, and post-sale staking on Solana.

This version includes a newly added frontend application (Next.js) that provides admin and investor interfaces for end-to-end protocol interaction.

This repository contains:
- An Anchor smart contract program with explicit authority boundaries and deterministic PDA design.
- An integration test suite that covers both expected flows and adversarial edge cases.
- A Next.js frontend for admin and investor workflows, including token metadata profile rendering.

## Table of Contents

1. Executive Summary
2. Repository Layout
3. Smart Contract Architecture
4. Instruction Set and Business Logic
5. Account Model and PDA Topology
6. Security Design and Safeguards
7. Test Scope and Verification Strategy
8. Frontend Architecture and UX Flows
9. Local Development and Environment Setup
10. Build, Test, and Validation Commands
11. Deployment and IDL Synchronization
12. Operational Runbook
13. Known Constraints and Non-Blocking Warnings
14. GitHub Publication Checklist
15. Disclaimer

## 1. Executive Summary

The protocol is designed to support disciplined token distribution and post-sale token utility while preserving safety under common attack surfaces.

Core capabilities:
- Staged pricing model with per-stage accounting.
- Configurable soft cap, hard cap, and per-wallet cap.
- Vesting with cliff and linear unlock.
- Optional referral bonuses with strict token-account validation.
- Refunds when soft cap is not met.
- Admin controls for pause, finalization, withdrawals, and action timelock.
- Staking pool with reward-per-share accounting and controlled reward inventory.

Program details:
- Program name: presale
- Program ID: EQFvxjAWVQvy3JBr2wHgVWwjujpUzCt9X42qGaHTMEdn
- Framework: Anchor 0.31.1

Release note:
- The frontend in app/ is a new addition that completes the repository as a fullstack delivery (contract + tests + web client).

## 2. Repository Layout

- programs/presale/src/lib.rs: Program entrypoint and instruction routing.
- programs/presale/src/admin.rs: Admin instruction handlers.
- programs/presale/src/investor.rs: Investor purchase, vesting claim, and refund logic.
- programs/presale/src/staking.rs: Staking initialization, fund, stake, unstake, claim rewards.
- programs/presale/src/contexts.rs: Account constraints and instruction account schemas.
- programs/presale/src/state.rs: On-chain account state structs.
- programs/presale/src/errors.rs: Custom domain errors.
- programs/presale/src/events.rs: Event emissions used by client/indexer observability.
- programs/presale/src/constants.rs: PDA seeds and protocol constants.
- programs/presale/src/utils.rs: Shared staking pool update and gating helpers.
- tests/presale.ts: Integration and adversarial tests.
- app/src/components/PresaleConsole.tsx: Shared admin/investor frontend workflow console.
- app/src/lib/*: Frontend helpers for constants, PDAs, formatting, program initialization.

## 3. Smart Contract Architecture

### 3.1 Modules and Responsibility Boundaries

The on-chain design separates concerns by module:
- admin.rs controls token creation, presale initialization, vault funding, lifecycle state transitions, and administrative withdrawals.
- investor.rs handles user purchases, vesting claims, and refund claims.
- staking.rs handles staking pool initialization and reward distribution mechanics.

This separation improves maintainability and reduces the probability of cross-domain logic errors.

### 3.2 State-Centric Design

The presale state account is the protocol anchor for each deployment and stores:
- Governance and identity fields: admin, treasury, mint, metadata fields.
- Economic configuration: caps, sale supply, referral bps.
- Time windows and vesting parameters.
- Dynamic progress: raised funds, sold tokens, current stage.
- Safety metadata: PDA bumps and admin lock timestamp.

### 3.3 Lifecycle Model

The protocol follows a strict lifecycle:
1. Token mint can be created by admin with metadata and fixed supply (mint authority revoked).
2. Presale is initialized with staged pricing and timing.
3. Vault is funded before sale start.
4. Investors purchase during active window.
5. Presale is finalized after end.
6. Either:
- Soft cap met: treasury withdrawal + vesting claims + staking activation.
- Soft cap not met: users claim refunds.

## 4. Instruction Set and Business Logic

The program routes the following instructions:
- create_token
- initialize_presale
- fund_presale_vault
- buy_tokens
- claim_vested
- claim_refund
- toggle_pause
- finalize_presale
- withdraw_funds
- withdraw_unsold
- initialize_staking
- fund_reward_vault
- stake
- unstake
- claim_rewards
- set_admin_actions_lock

### 4.1 create_token

Behavior:
- Creates classic SPL mint.
- Optionally initializes Metaplex metadata account (when metadata program is present on validator).
- Mints initial supply to admin ATA.
- Revokes mint authority to enforce fixed supply.

Validation highlights:
- Metadata size constraints.
- PDA validation for mint authority and metadata account.
- Metadata program identity check.

### 4.2 initialize_presale

Behavior:
- Initializes protocol state + token vault + SOL vault PDAs.
- Stores token profile fields in state for client rendering fallback.
- Stores up to five sale stages.

Validation highlights:
- start_time > current chain time.
- end_time > start_time.
- hard_cap >= soft_cap > 0.
- max contribution bounded and non-zero.
- vesting cliff/duration validity.
- referral rate bounded.
- stage list non-empty and bounded.
- sum(stage.tokens_available) == tokens_for_sale.

### 4.3 buy_tokens

Behavior:
- Walks stages sequentially and computes token fills using current stage price.
- Charges only consumed SOL (not requested SOL) and transfers consumed amount to SOL vault.
- Locks purchased tokens in user vesting account.
- Optionally pays referral bonus from token vault.

Validation highlights:
- Requires active and non-paused presale.
- Enforces sale time window.
- Enforces wallet contribution cap.
- Enforces hard cap.
- Enforces non-zero effective purchase.
- Validates referral ATA ownership/mint expectations.
- Blocks self-referral.

### 4.4 claim_vested

Behavior:
- Unlocks vested tokens linearly after cliff.
- Transfers releasable amount from token vault to user ATA.
- Enforces minimum claim amount except for final full unlock.

Validation highlights:
- Requires soft cap met.
- Requires cliff elapsed.
- Requires non-zero releasable amount.

### 4.5 claim_refund

Behavior:
- Allows users to reclaim contributed lamports if soft cap failed.
- Transfers from SOL vault PDA to user signer.

Validation highlights:
- Requires sale ended.
- Requires soft cap not met.
- Requires non-zero contribution to refund.

### 4.6 Staking Instructions

initialize_staking:
- Admin-only.
- Configures reward rate with explicit max bound.

fund_reward_vault:
- Admin-only.
- Funds reward token inventory and updates remaining rewards.

stake:
- Requires staking eligibility gates.
- Transfers tokens to stake vault.
- Updates user amount, pool total, and reward debt.

unstake:
- Requires staking eligibility gates.
- Updates pool first, pays pending rewards, returns unstaked principal.
- Recomputes user reward debt after balance change.

claim_rewards:
- Requires staking eligibility gates.
- Transfers pending rewards from reward vault.

### 4.7 Admin Lifecycle Controls

toggle_pause:
- Admin-only.
- Disabled while action lock is active.

finalize_presale:
- Admin-only.
- Requires sale end.
- Sets active=false and emits completion summary.

withdraw_funds:
- Admin-only and treasury-address constrained.
- Requires sale end and soft cap met.

withdraw_unsold:
- Admin-only.
- Allows reclaiming unsold vault inventory after accounting for sold and referral totals.

set_admin_actions_lock:
- Admin-only.
- Sets unlock timestamp for deferred admin actions.

## 5. Account Model and PDA Topology

Primary seeds:
- presale_config
- token_vault
- sol_vault
- mint-authority
- user_vesting
- stake_pool
- stake_vault
- reward_vault
- user_stake
- vault_authority

Security intent:
- Every critical state/vault path is deterministic and namespaced by the presale state key.
- Stake/reward vault authorities are PDA-controlled, not externally held keys.
- Treasury account is constrained by state-stored address in withdrawal context.

## 6. Security Design and Safeguards

### 6.1 Access Control

- Admin signer checks are enforced against persisted state admin.
- Unauthorized signers are rejected for all privileged operations.
- Treasury withdrawal destination is pinned to configured treasury account.

### 6.2 Timing and Lifecycle Enforcement

- Sale window checks enforce open/close timing for purchases.
- Vault funding is blocked after sale start.
- Finalization and treasury withdrawal require sale completion timing.
- Staking eligibility requires finalized sale and soft cap success.

### 6.3 Economic Integrity

- Hard cap and wallet cap are enforced at buy time.
- Stage totals must exactly match advertised tokens_for_sale.
- Buy loop charges only consumed SOL, protecting users from overcharge in stage traversal.

### 6.4 Arithmetic Safety

- checked_add, checked_sub, checked_mul, checked_div are used for sensitive math.
- Overflow conditions return explicit custom errors.

### 6.5 Referral Abuse Controls

- Self-referral blocked.
- Referral token account must match canonical ATA for provided referrer and mint.
- Referral token account owner must match token program.

### 6.6 Vault Safety

- Vault transfers requiring protocol authority use signer seeds with PDA derivation.
- Token account mint and ownership constraints are enforced in contexts and handlers.

### 6.7 Administrative Time Lock

- Critical admin operations are blocked until admin_actions_locked_until has elapsed.
- Lock is settable only by admin with future timestamp.

## 7. Test Scope and Verification Strategy

The test suite at tests/presale.ts exercises both standard and adversarial paths.

### 7.1 Functional Coverage

- Token creation writes metadata and revokes mint authority.
- Presale initialization stores token profile fields.
- Multi-stage buys update state and vesting consistently.
- Post-finalization staking lifecycle works end-to-end.

### 7.2 Security and Negative Testing

- Invalid vesting configuration rejected.
- Self-referral and forged referral ATA rejected.
- Unauthorized reward vault funding rejected.
- Unauthorized treasury withdrawal rejected.
- Admin timelock blocks privileged actions.
- Zero-value stake and reward funding rejected.
- Cliff enforcement blocks early vesting claims.

### 7.3 Accounting and Edge Cases

- Multi-stage rounding boundaries validated.
- SOL vault delta is asserted against contributed accounting.
- Reward debt recomputation verified during partial unstake.

### 7.4 How to Run Tests

From repository root:

```bash
anchor build
anchor test
```

The test command is defined in Anchor.toml and uses ts-mocha against tests/**/*.ts.

## 8. Frontend Architecture and UX Flows

The frontend is a Next.js application in app/ and provides two operator surfaces:
- /admin: Configuration and lifecycle management.
- /investor: Purchase, claim, and staking interactions.

### 8.1 Frontend Technical Stack

- Next.js 14
- React 18
- @coral-xyz/anchor client
- Solana wallet adapter ecosystem
- SPL Token and Web3.js helpers

### 8.2 Frontend Functional Highlights

- Guided, sequential admin flow to reduce ordering mistakes.
- Input validation aligned with on-chain constraints.
- Shared local-state hydration for admin/mint/treasury continuity.
- Auto-derivation of PDAs and associated token accounts.
- Action notices with surfaced transaction signatures.

### 8.3 Token Profile and Thumbnail Support

Investor token profile uses multiple data sources for resilience:
- State-level token metadata fields from initialize_presale.
- Metaplex metadata decode where available.
- Metadata URI fetch support (including ipfs:// normalization) for name/symbol/description/image hydration.

This enables thumbnail and profile rendering even when metadata is provided via JSON URI.

### 8.4 Frontend-Contract Sync Requirement

When contract interfaces change, synchronize IDL and client usage:
- target/idl/presale.json should match app/src/idl/presale.json.

IDL drift can cause account-order or argument mismatch at runtime.

## 9. Local Development and Environment Setup

Prerequisites:
- Rust stable toolchain
- Solana CLI
- Anchor CLI
- Node.js 18+ (recommended for Next.js 14)
- Yarn (Anchor.toml test script uses yarn)

Install dependencies:

```bash
# root dependencies (tests, Anchor JS tooling)
npm install

# frontend dependencies
cd app
npm install
cd ..
```

## 10. Build, Test, and Validation Commands

From repository root:

```bash
# build on-chain program
anchor build

# run Anchor integration tests
anchor test

# run frontend dev server
cd app && npm run dev

# frontend production build
cd app && npm run build
```

Optional formatting/lint checks in root package.json:

```bash
npm run lint
npm run lint:fix
```

## 11. Deployment and IDL Synchronization

### 11.1 Program Configuration

Anchor.toml currently includes:
- provider.cluster = localnet
- programs.devnet.presale = EQFvxjAWVQvy3JBr2wHgVWwjujpUzCt9X42qGaHTMEdn

Adjust cluster/wallet settings according to deployment target.

### 11.2 IDL Sync Steps

After rebuilding program interfaces:

```bash
cp target/idl/presale.json app/src/idl/presale.json
```

Then rebuild frontend:

```bash
cd app && npm run build
```

## 12. Operational Runbook

### 12.1 Recommended Admin Execution Order

1. Create token (optional if using existing mint).
2. Initialize presale with validated timing and stage data.
3. Fund presale token vault before start_time.
4. Monitor purchases and state evolution.
5. After end_time, finalize presale.
6. If soft cap met:
- withdraw SOL to treasury
- manage staking (initialize/fund).
7. If soft cap not met:
- users claim refunds.
8. Optionally withdraw unsold tokens after sale completion.

### 12.2 Investor Flow

1. Load state.
2. Buy tokens during active sale window.
3. Claim vested tokens after cliff and according to unlock schedule.
4. If sale fails soft cap, claim refund instead.
5. Stake tokens when staking is enabled and sale finalized.

## 13. Known Constraints and Non-Blocking Warnings

Observed in local/frontend builds:
- Missing pino-pretty warning via walletconnect dependency chain.
- Critical dependency warning in viem/ox tempo modules.
- bigint native bindings fallback warning.

These warnings are currently non-blocking for build completion but should be tracked for dependency maintenance.

## 14. GitHub Publication Checklist

Target repository:
- https://github.com/MuhKar1/Solana-Presale-Staking

Publication intent:
- Publish as a fullstack project, including the newly added frontend under app/.

Before pushing:
1. Confirm no secrets are committed.
2. Confirm .gitignore excludes target, node_modules, test-ledger, and .anchor artifacts.
3. Run anchor test and app build at least once.
4. Verify README accuracy after any interface changes.

Example push workflow:

```bash
git init
git remote add origin https://github.com/MuhKar1/Solana-Presale-Staking.git
git add .
git commit -m "feat: fullstack presale + staking protocol"
git branch -M main
git push -u origin main
```

If the repository already exists locally with history, skip git init and remote steps as appropriate.

## 15. Disclaimer

This codebase is a technical implementation and reference, not legal, financial, or investment advice. Conduct an independent security review and formal audit before production deployment with real value.
