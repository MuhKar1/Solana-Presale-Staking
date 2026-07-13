import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Presale } from "../target/types/presale";

describe("presale", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  const payer = wallet.payer;

  const program = anchor.workspace.presale as Program<Presale>;

  const seeds = {
    config: Buffer.from("presale_config"),
    tokenVault: Buffer.from("token_vault"),
    solVault: Buffer.from("sol_vault"),
    mintAuthority: Buffer.from("mint-authority"),
    vesting: Buffer.from("user_vesting"),
    stakePool: Buffer.from("stake_pool"),
    stakeVault: Buffer.from("stake_vault"),
    rewardVault: Buffer.from("reward_vault"),
    userStake: Buffer.from("user_stake"),
    vaultAuthority: Buffer.from("vault_authority"),
  };

  const airdrop = async (pk: PublicKey, sol = 10) => {
    const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  };

  const derive = (adminPk: PublicKey, state?: PublicKey, user?: PublicKey) => {
    const [statePda] = PublicKey.findProgramAddressSync(
      [seeds.config, adminPk.toBuffer()],
      program.programId
    );
    const stateKey = state ?? statePda;
    const [tokenVault] = PublicKey.findProgramAddressSync(
      [seeds.tokenVault, stateKey.toBuffer()],
      program.programId
    );
    const [solVault] = PublicKey.findProgramAddressSync(
      [seeds.solVault, stateKey.toBuffer()],
      program.programId
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [seeds.vaultAuthority, stateKey.toBuffer()],
      program.programId
    );
    const [pool] = PublicKey.findProgramAddressSync(
      [seeds.stakePool, stateKey.toBuffer()],
      program.programId
    );
    const [stakeVault] = PublicKey.findProgramAddressSync(
      [seeds.stakeVault, stateKey.toBuffer()],
      program.programId
    );
    const [rewardVault] = PublicKey.findProgramAddressSync(
      [seeds.rewardVault, stateKey.toBuffer()],
      program.programId
    );
    const vestingPda = user
      ? PublicKey.findProgramAddressSync([seeds.vesting, user.toBuffer()], program.programId)[0]
      : PublicKey.default;
    const userStakePda = user
      ? PublicKey.findProgramAddressSync([seeds.userStake, user.toBuffer()], program.programId)[0]
      : PublicKey.default;

    return {
      state: stateKey,
      tokenVault,
      solVault,
      vaultPda,
      pool,
      stakeVault,
      rewardVault,
      vestingPda,
      userStakePda,
    };
  };

  type SetupResult = {
    admin: Keypair;
    mint: PublicKey;
    treasury: Keypair;
    user: Keypair;
    referrer: Keypair;
    adminTokenAta: PublicKey;
    userTokenAta: PublicKey;
    referrerTokenAta: PublicKey;
    state: PublicKey;
    tokenVault: PublicKey;
    solVault: PublicKey;
    vaultPda: PublicKey;
    pool: PublicKey;
    stakeVault: PublicKey;
    rewardVault: PublicKey;
    userVesting: PublicKey;
    userStake: PublicKey;
    startTime: number;
    endTime: number;
    stages: { pricePerToken: anchor.BN; tokensAvailable: anchor.BN; tokensSoldInStage: anchor.BN }[];
  };

  const setupProtocol = async (opts?: {
    startOffsetSec?: number;
    durationSec?: number;
    vestingDurationSec?: number;
    vestingCliffSec?: number;
    referralBps?: number;
    softCapLamports?: number;
    hardCapLamports?: number;
    maxContributionLamports?: number;
  }): Promise<SetupResult> => {
    const scenarioAdmin = Keypair.generate();
    const treasury = Keypair.generate();
    const user = Keypair.generate();
    const referrer = Keypair.generate();
    await airdrop(scenarioAdmin.publicKey, 20);
    await airdrop(treasury.publicKey, 5);
    await airdrop(user.publicKey, 20);
    await airdrop(referrer.publicKey, 5);

    const mint = await createMint(
      connection,
      payer,
      scenarioAdmin.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const adminTokenAta = await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      scenarioAdmin.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const userTokenAta = await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      user.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const referrerTokenAta = await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      referrer.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await mintTo(
      connection,
      payer,
      mint,
      adminTokenAta,
      scenarioAdmin,
      BigInt(5_000_000_000_000),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const pdas = derive(scenarioAdmin.publicKey, undefined, user.publicKey);

    const now = await currentChainUnix();
    const startTime = now + (opts?.startOffsetSec ?? 20);
    const endTime = startTime + (opts?.durationSec ?? 120);
    const vestingDuration = opts?.vestingDurationSec ?? 600;
    const vestingCliff = opts?.vestingCliffSec ?? 60;
    const softCapLamports = opts?.softCapLamports ?? 1 * LAMPORTS_PER_SOL;
    const hardCapLamports = opts?.hardCapLamports ?? 20 * LAMPORTS_PER_SOL;
    const maxContributionLamports = opts?.maxContributionLamports ?? 10 * LAMPORTS_PER_SOL;

    const stages = [
      {
        pricePerToken: new anchor.BN(50_000),
        tokensAvailable: new anchor.BN(500_000_000),
        tokensSoldInStage: new anchor.BN(0),
      },
      {
        pricePerToken: new anchor.BN(100_000),
        tokensAvailable: new anchor.BN(500_000_000),
        tokensSoldInStage: new anchor.BN(0),
      },
    ];

    await program.methods
      .initializePresale(
        new anchor.BN(softCapLamports),
        new anchor.BN(hardCapLamports),
        new anchor.BN(maxContributionLamports),
        new anchor.BN(1_000_000_000),
        new anchor.BN(startTime),
        new anchor.BN(endTime),
        new anchor.BN(vestingDuration),
        new anchor.BN(vestingCliff),
        new anchor.BN(1),
        opts?.referralBps ?? 500,
        stages
      )
      .accounts({
        state: pdas.state,
        mint,
        tokenVault: pdas.tokenVault,
        vaultPda: pdas.vaultPda,
        solVault: pdas.solVault,
        admin: scenarioAdmin.publicKey,
        treasury: treasury.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([scenarioAdmin])
      .rpc();

    await program.methods
      .fundPresaleVault(new anchor.BN(1_000_000_000))
      .accounts({
        state: pdas.state,
        admin: scenarioAdmin.publicKey,
        adminTokenAccount: adminTokenAta,
        mint,
        vault: pdas.tokenVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([scenarioAdmin])
      .rpc();

    return {
      admin: scenarioAdmin,
      mint,
      treasury,
      user,
      referrer,
      adminTokenAta,
      userTokenAta,
      referrerTokenAta,
      state: pdas.state,
      tokenVault: pdas.tokenVault,
      solVault: pdas.solVault,
      vaultPda: pdas.vaultPda,
      pool: pdas.pool,
      stakeVault: pdas.stakeVault,
      rewardVault: pdas.rewardVault,
      userVesting: pdas.vestingPda,
      userStake: pdas.userStakePda,
      startTime,
      endTime,
      stages,
    };
  };

  const expectFail = async (p: Promise<unknown>, label: string) => {
    let failed = false;
    try {
      await p;
    } catch {
      failed = true;
    }
    expect(failed, label).to.eq(true);
  };

  const currentChainUnix = async (): Promise<number> => {
    const slot = await connection.getSlot("confirmed");
    const ts = await connection.getBlockTime(slot);
    if (ts !== null) return ts;
    return Math.floor(Date.now() / 1000);
  };

  const waitUntilUnix = async (ts: number) => {
    // Use validator clock (slot block time), not local machine clock.
    const timeoutMs = 60_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const slot = await connection.getSlot("confirmed");
      const chainTs = await connection.getBlockTime(slot);

      if (chainTs !== null && chainTs >= ts) {
        return;
      }

      // Briefly wait and let new slots produce.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    throw new Error(`Timed out waiting for chain time >= ${ts}`);
  };

  it("rejects invalid init parameters (vesting cliff > duration)", async () => {
    const scenarioAdmin = Keypair.generate();
    await airdrop(scenarioAdmin.publicKey, 10);
    const treasury = Keypair.generate();
    await airdrop(treasury.publicKey, 2);
    const mint = await createMint(
      connection,
      payer,
      scenarioAdmin.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const pdas = derive(scenarioAdmin.publicKey);

    const now = await currentChainUnix();
    const stages = [{
      pricePerToken: new anchor.BN(50_000),
      tokensAvailable: new anchor.BN(1_000_000),
      tokensSoldInStage: new anchor.BN(0),
    }];

    await expectFail(
      program.methods
        .initializePresale(
          new anchor.BN(1_000_000),
          new anchor.BN(2_000_000),
          new anchor.BN(1_000_000),
          new anchor.BN(1_000_000),
          new anchor.BN(now + 60),
          new anchor.BN(now + 120),
          new anchor.BN(100),
          new anchor.BN(101),
          new anchor.BN(1),
          100,
          stages
        )
        .accounts({
          state: pdas.state,
          mint,
          tokenVault: pdas.tokenVault,
          vaultPda: pdas.vaultPda,
          solVault: pdas.solVault,
          admin: scenarioAdmin.publicKey,
          treasury: treasury.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([scenarioAdmin])
        .rpc(),
      "initializePresale should reject invalid vesting cliff"
    );
  });

  it("blocks referral self-ref and invalid referral token account (drain attempt)", async () => {
    const env = await setupProtocol();
    await expectFail(
      program.methods
        .buyTokens(new anchor.BN(1 * LAMPORTS_PER_SOL), env.user.publicKey)
        .accounts({
          state: env.state,
          buyer: env.user.publicKey,
          solVault: env.solVault,
          mint: env.mint,
          vault: env.tokenVault,
          vaultPda: env.vaultPda,
          vesting: env.userVesting,
          referrerTokenAccount: env.referrerTokenAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.user])
        .rpc(),
      "self-referral should fail"
    );

    const fakeRefAta = Keypair.generate();
    await airdrop(fakeRefAta.publicKey, 1);
    await expectFail(
      program.methods
        .buyTokens(new anchor.BN(1 * LAMPORTS_PER_SOL), env.referrer.publicKey)
        .accounts({
          state: env.state,
          buyer: env.user.publicKey,
          solVault: env.solVault,
          mint: env.mint,
          vault: env.tokenVault,
          vaultPda: env.vaultPda,
          vesting: env.userVesting,
          referrerTokenAccount: fakeRefAta.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.user])
        .rpc(),
      "invalid referral token account should fail"
    );
  });

  it("charges only consumed SOL in multi-stage buy edge case", async () => {
    const env = await setupProtocol({ startOffsetSec: 5, durationSec: 180 });

    await waitUntilUnix(env.startTime + 1);

    const solVaultBefore = await connection.getBalance(env.solVault);

    // Large value to trigger stage traversal and potential leftover rounding paths.
    await program.methods
      .buyTokens(new anchor.BN(3 * LAMPORTS_PER_SOL), env.referrer.publicKey)
      .accounts({
        state: env.state,
        buyer: env.user.publicKey,
        solVault: env.solVault,
        mint: env.mint,
        vault: env.tokenVault,
        vaultPda: env.vaultPda,
        vesting: env.userVesting,
        referrerTokenAccount: env.referrerTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    const vestingAcc = await program.account.userVesting.fetch(env.userVesting);
    const stateAcc = await program.account.presaleState.fetch(env.state);
    const solVaultAfter = await connection.getBalance(env.solVault);
    const solVaultDelta = solVaultAfter - solVaultBefore;

    // Compare vault delta to avoid counting rent-exempt baseline lamports.
    expect(solVaultDelta).to.eq(vestingAcc.contributedLamports.toNumber());
    expect(solVaultDelta).to.eq(stateAcc.totalRaisedLamports.toNumber());
    expect(solVaultDelta).to.be.lessThanOrEqual(3 * LAMPORTS_PER_SOL);
  });

  it("enforces staking gating and blocks unauthorized reward drain attempts", async () => {
    const env = await setupProtocol({ startOffsetSec: 2, durationSec: 8 });
    const attacker = Keypair.generate();
    await airdrop(attacker.publicKey, 5);

    const attackerTokenAta = await createAssociatedTokenAccount(
      connection,
      payer,
      env.mint,
      attacker.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await program.methods
      .initializeStaking(new anchor.BN(10_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        admin: env.admin.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        rewardVault: env.rewardVault,
        vaultPda: env.vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([env.admin])
      .rpc();

    // Should fail before finalize/end.
    await expectFail(
      program.methods
        .stake(new anchor.BN(1_000_000))
        .accounts({
          state: env.state,
          pool: env.pool,
          userStake: env.userStake,
          user: env.user.publicKey,
          mint: env.mint,
          stakeVault: env.stakeVault,
          userToken: env.userTokenAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([env.user])
        .rpc(),
      "stake should fail before presale finalization"
    );

    // Unauthorized signer should never be able to fund rewards.
    await expectFail(
      program.methods
        .fundRewardVault(new anchor.BN(1_000_000))
        .accounts({
          state: env.state,
          pool: env.pool,
          admin: attacker.publicKey,
          mint: env.mint,
          adminTokenAccount: attackerTokenAta,
          rewardVault: env.rewardVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
      "fundRewardVault should reject non-admin signer"
    );
  });

  it("protects admin actions with timelock and authorization", async () => {
    const env = await setupProtocol();
    const attacker = Keypair.generate();
    await airdrop(attacker.publicKey, 5);

    const future = (await currentChainUnix()) + 600;

    await expectFail(
      program.methods
        .setAdminActionsLock(new anchor.BN(future))
        .accounts({ state: env.state, admin: attacker.publicKey })
        .signers([attacker])
        .rpc(),
      "non-admin cannot set lock"
    );

    await program.methods
      .setAdminActionsLock(new anchor.BN(future))
      .accounts({ state: env.state, admin: env.admin.publicKey })
      .signers([env.admin])
      .rpc();

    await expectFail(
      program.methods
        .togglePause(true)
        .accounts({ state: env.state, admin: env.admin.publicKey })
        .signers([env.admin])
        .rpc(),
      "admin action should fail while timelocked"
    );
  });

  it("blocks unauthorized treasury withdrawal attempts", async () => {
    const env = await setupProtocol();
    const attacker = Keypair.generate();
    await airdrop(attacker.publicKey, 5);

    await expectFail(
      program.methods
        .withdrawFunds()
        .accounts({
          state: env.state,
          solVault: env.solVault,
          treasury: attacker.publicKey,
          admin: attacker.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc(),
      "attacker withdrawFunds should fail"
    );
  });

  it("rejects zero-value staking operations and empty reward funding", async () => {
    const env = await setupProtocol({
      startOffsetSec: 4,
      durationSec: 8,
      softCapLamports: 50_000_000,
      hardCapLamports: 2 * LAMPORTS_PER_SOL,
      maxContributionLamports: 2 * LAMPORTS_PER_SOL,
    });

    await program.methods
      .initializeStaking(new anchor.BN(1_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        admin: env.admin.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        rewardVault: env.rewardVault,
        vaultPda: env.vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([env.admin])
      .rpc();

    await waitUntilUnix(env.startTime + 1);

    await program.methods
      .buyTokens(new anchor.BN(1 * LAMPORTS_PER_SOL), env.referrer.publicKey)
      .accounts({
        state: env.state,
        buyer: env.user.publicKey,
        solVault: env.solVault,
        mint: env.mint,
        vault: env.tokenVault,
        vaultPda: env.vaultPda,
        vesting: env.userVesting,
        referrerTokenAccount: env.referrerTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    await waitUntilUnix(env.endTime + 2);

    await program.methods
      .finalizePresale()
      .accounts({ state: env.state, admin: env.admin.publicKey })
      .signers([env.admin])
      .rpc();

    await mintTo(
      connection,
      payer,
      env.mint,
      env.userTokenAta,
      env.admin,
      BigInt(1_000_000),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await expectFail(
      program.methods
        .fundRewardVault(new anchor.BN(0))
        .accounts({
          state: env.state,
          pool: env.pool,
          admin: env.admin.publicKey,
          mint: env.mint,
          adminTokenAccount: env.adminTokenAta,
          rewardVault: env.rewardVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([env.admin])
        .rpc(),
      "zero reward funding should fail"
    );

    await expectFail(
      program.methods
        .stake(new anchor.BN(0))
        .accounts({
          state: env.state,
          pool: env.pool,
          userStake: env.userStake,
          user: env.user.publicKey,
          mint: env.mint,
          stakeVault: env.stakeVault,
          userToken: env.userTokenAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([env.user])
        .rpc(),
      "zero stake should fail"
    );
  });

  it("allows client to stake after presale finalization", async () => {
    const env = await setupProtocol({
      startOffsetSec: 5,
      durationSec: 12,
      vestingCliffSec: 0,
      vestingDurationSec: 60,
      softCapLamports: 50_000_000,
      hardCapLamports: 2 * LAMPORTS_PER_SOL,
      maxContributionLamports: 2 * LAMPORTS_PER_SOL,
    });

    await waitUntilUnix(env.startTime + 1);

    // Meet soft cap with a real buy.
    await program.methods
      .buyTokens(new anchor.BN(2 * LAMPORTS_PER_SOL), env.referrer.publicKey)
      .accounts({
        state: env.state,
        buyer: env.user.publicKey,
        solVault: env.solVault,
        mint: env.mint,
        vault: env.tokenVault,
        vaultPda: env.vaultPda,
        vesting: env.userVesting,
        referrerTokenAccount: env.referrerTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    await waitUntilUnix(env.endTime + 2);

    await program.methods
      .finalizePresale()
      .accounts({
        state: env.state,
        admin: env.admin.publicKey,
      })
      .signers([env.admin])
      .rpc();

    await program.methods
      .initializeStaking(new anchor.BN(100_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        admin: env.admin.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        rewardVault: env.rewardVault,
        vaultPda: env.vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([env.admin])
      .rpc();

    await program.methods
      .fundRewardVault(new anchor.BN(5_000_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        admin: env.admin.publicKey,
        mint: env.mint,
        adminTokenAccount: env.adminTokenAta,
        rewardVault: env.rewardVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([env.admin])
      .rpc();

    // Give user stakeable balance for function-level staking validation.
    await mintTo(
      connection,
      payer,
      env.mint,
      env.userTokenAta,
      env.admin,
      BigInt(10_000_000),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .stake(new anchor.BN(1_000_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        userStake: env.userStake,
        user: env.user.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        userToken: env.userTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([env.user])
      .rpc();

    const userStakeAcc = await program.account.userStake.fetch(env.userStake);
    const poolAcc = await program.account.stakePool.fetch(env.pool);

    expect(userStakeAcc.amount.toNumber()).to.eq(1_000_000);
    expect(userStakeAcc.user.toBase58()).to.eq(env.user.publicKey.toBase58());
    expect(poolAcc.totalStaked.toNumber()).to.eq(1_000_000);
  });

  it("handles precise multi-stage rounding boundaries without trapping dust", async () => {
    const env = await setupProtocol({ startOffsetSec: 4, durationSec: 120 });
    await waitUntilUnix(env.startTime + 1);

    const solVaultBefore = await connection.getBalance(env.solVault);

    const quirkySolAmount = new anchor.BN(2_333_333_333);

    await program.methods
      .buyTokens(quirkySolAmount, env.referrer.publicKey)
      .accounts({
        state: env.state,
        buyer: env.user.publicKey,
        solVault: env.solVault,
        mint: env.mint,
        vault: env.tokenVault,
        vaultPda: env.vaultPda,
        vesting: env.userVesting,
        referrerTokenAccount: env.referrerTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    const vestingAcc = await program.account.userVesting.fetch(env.userVesting);
    const stateAcc = await program.account.presaleState.fetch(env.state);
    const solVaultAfter = await connection.getBalance(env.solVault);
    const solVaultDelta = solVaultAfter - solVaultBefore;

    expect(solVaultDelta).to.eq(vestingAcc.contributedLamports.toNumber());
    expect(solVaultDelta).to.eq(stateAcc.totalRaisedLamports.toNumber());
    expect(solVaultDelta).to.be.lessThanOrEqual(quirkySolAmount.toNumber());
  });

  it("recomputes reward debt accurately during partial unstake", async () => {
    const env = await setupProtocol({
      startOffsetSec: 4,
      durationSec: 8,
      vestingCliffSec: 0,
      vestingDurationSec: 60,
      softCapLamports: 50_000_000,
      hardCapLamports: 2 * LAMPORTS_PER_SOL,
      maxContributionLamports: 2 * LAMPORTS_PER_SOL,
    });
    await waitUntilUnix(env.startTime + 1);

    await program.methods
      .buyTokens(new anchor.BN(2 * LAMPORTS_PER_SOL), env.referrer.publicKey)
      .accounts({
        state: env.state,
        buyer: env.user.publicKey,
        solVault: env.solVault,
        mint: env.mint,
        vault: env.tokenVault,
        vaultPda: env.vaultPda,
        vesting: env.userVesting,
        referrerTokenAccount: env.referrerTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    await waitUntilUnix(env.endTime + 2);

    await program.methods
      .finalizePresale()
      .accounts({
        state: env.state,
        admin: env.admin.publicKey,
      })
      .signers([env.admin])
      .rpc();

    await program.methods
      .initializeStaking(new anchor.BN(10_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        admin: env.admin.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        rewardVault: env.rewardVault,
        vaultPda: env.vaultPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([env.admin])
      .rpc();

    await program.methods
      .fundRewardVault(new anchor.BN(10_000_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        admin: env.admin.publicKey,
        mint: env.mint,
        adminTokenAccount: env.adminTokenAta,
        rewardVault: env.rewardVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([env.admin])
      .rpc();

    await mintTo(
      connection,
      payer,
      env.mint,
      env.userTokenAta,
      env.admin,
      BigInt(2_000_000),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .stake(new anchor.BN(2_000_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        userStake: env.userStake,
        user: env.user.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        userToken: env.userTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([env.user])
      .rpc();

    // Let pool accrue some rewards before partial unstake.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    await program.methods
      .unstake(new anchor.BN(1_000_000))
      .accounts({
        state: env.state,
        pool: env.pool,
        userStake: env.userStake,
        user: env.user.publicKey,
        mint: env.mint,
        stakeVault: env.stakeVault,
        rewardVault: env.rewardVault,
        vaultPda: env.vaultPda,
        userToken: env.userTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    const userStakeAcc = await program.account.userStake.fetch(env.userStake);
    expect(userStakeAcc.amount.toNumber()).to.eq(1_000_000);
    expect(userStakeAcc.rewardDebt.toNumber()).to.be.greaterThan(0);
  });

  it("strictly locks claims before cliff", async () => {
    const env = await setupProtocol({ startOffsetSec: 4, durationSec: 8, vestingCliffSec: 20, vestingDurationSec: 120 });
    await waitUntilUnix(env.startTime + 1);

    await program.methods
      .buyTokens(new anchor.BN(1 * LAMPORTS_PER_SOL), env.referrer.publicKey)
      .accounts({
        state: env.state,
        buyer: env.user.publicKey,
        solVault: env.solVault,
        mint: env.mint,
        vault: env.tokenVault,
        vaultPda: env.vaultPda,
        vesting: env.userVesting,
        referrerTokenAccount: env.referrerTokenAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([env.user])
      .rpc();

    await waitUntilUnix(env.endTime + 2);

    await program.methods
      .finalizePresale()
      .accounts({
        state: env.state,
        admin: env.admin.publicKey,
      })
      .signers([env.admin])
      .rpc();

    await expectFail(
      program.methods
        .claimVested()
        .accounts({
          state: env.state,
          vesting: env.userVesting,
          user: env.user.publicKey,
          mint: env.mint,
          vault: env.tokenVault,
          vaultPda: env.vaultPda,
          userTokenAccount: env.userTokenAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([env.user])
        .rpc(),
      "Should block vesting claim while within the cliff window"
    );
  });
});
