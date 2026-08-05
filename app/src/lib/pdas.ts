import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CONFIG_SEED,
  METADATA_PROGRAM_ID,
  PROGRAM_ID,
  REWARD_VAULT_SEED,
  SOL_VAULT_SEED,
  STAKE_POOL_SEED,
  STAKE_VAULT_SEED,
  TOKEN_PROGRAM_ID,
  TOKEN_VAULT_SEED,
  USER_STAKE_SEED,
  VAULT_AUTHORITY_SEED,
  VESTING_SEED,
} from "./constants";

export function deriveState(admin: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED), admin.toBuffer()], PROGRAM_ID)[0];
}

export function deriveTokenVault(state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(TOKEN_VAULT_SEED), state.toBuffer()], PROGRAM_ID)[0];
}

export function deriveSolVault(state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(SOL_VAULT_SEED), state.toBuffer()], PROGRAM_ID)[0];
}

export function deriveVesting(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(VESTING_SEED), user.toBuffer()], PROGRAM_ID)[0];
}

export function deriveStakePool(state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(STAKE_POOL_SEED), state.toBuffer()], PROGRAM_ID)[0];
}

export function deriveStakeVault(state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(STAKE_VAULT_SEED), state.toBuffer()], PROGRAM_ID)[0];
}

export function deriveRewardVault(state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(REWARD_VAULT_SEED), state.toBuffer()], PROGRAM_ID)[0];
}

export function deriveUserStake(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(USER_STAKE_SEED), user.toBuffer()], PROGRAM_ID)[0];
}

export function deriveVaultAuthority(state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(VAULT_AUTHORITY_SEED), state.toBuffer()], PROGRAM_ID)[0];
}

export function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

export function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0];
}
