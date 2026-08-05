"use client";

import { BN } from "@coral-xyz/anchor";
import { getMint } from "@solana/spl-token";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { humanizeError } from "@/lib/errorMaps";
import { fromTokenAmount, isoToUnix, shortPk, toLamports, toTokenAmount, unixToIso } from "@/lib/format";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  MINT_AUTHORITY_SEED,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/constants";
import {
  deriveAta,
  deriveMetadataPda,
  deriveRewardVault,
  deriveSolVault,
  deriveStakePool,
  deriveStakeVault,
  deriveState,
  deriveTokenVault,
  deriveUserStake,
  deriveVaultAuthority,
  deriveVesting,
} from "@/lib/pdas";
import { getProgram } from "@/lib/program";

type Notice = {
  kind: "ok" | "error";
  text: string;
  signature?: string;
  hints?: string[];
};

type StageInput = {
  priceSol: string;
  tokens: string;
};

export type ConsoleMode = "admin" | "investor";
const SHARED_INPUTS_KEY = "presale.shared.inputs.v1";
const NO_PRESALE_NOTICE = "No presale found for this admin wallet yet. If you are the deployer, use the 'Launch Presale' form in the Admin panel to create and initialize the sale.";
const MIN_START_OFFSET_SECONDS = 1;
const SAFE_START_OFFSET_SECONDS = 120;
const CONTRACT_MIN_SALE_DURATION_SECONDS = 1;
const UI_SAFE_MIN_SALE_DURATION_SECONDS = 60;
const DEFAULT_SALE_DURATION_SECONDS = 600;
const MIN_VESTING_DURATION_SECONDS = 1;
const MIN_VESTING_CLIFF_SECONDS = 0;

type ContractAction = {
  name: string;
  role: ConsoleMode | "shared";
  purpose: string;
  params: string[];
};

const CONTRACT_ACTIONS: ContractAction[] = [
  {
    name: "create_token(decimals, initial_supply, creator, name, symbol, uri, description)",
    role: "admin",
    purpose: "Creates a classic SPL mint, writes Metaplex metadata, mints fixed initial supply to the admin ATA, then removes mint authority.",
    params: [
      "decimals: u8",
      "initial_supply: u64",
      "creator: Option<Pubkey>",
      "name: String",
      "symbol: String",
      "uri: String",
      "description: String",
    ],
  },
  {
    name: "initialize_presale(...)",
    role: "admin",
    purpose: "Creates the presale state, vaults, timing, caps, token metadata, vesting rules, referral rate, and sale stages.",
    params: [
      "soft_cap: u64",
      "hard_cap: u64",
      "max_contribution: u64",
      "tokens_for_sale: u64",
      "start_time: i64",
      "end_time: i64",
      "vesting_duration: i64",
      "vesting_cliff: i64",
      "min_claim_amount: u64",
      "referral_bonus_bps: u16",
      "token_name: String",
      "token_symbol: String",
      "token_image_url: String",
      "token_description: String",
      "stages: Vec<PresaleStage>",
    ],
  },
  {
    name: "fund_presale_vault(amount)",
    role: "admin",
    purpose: "Transfers sale tokens from the admin token account into the presale token vault before the sale starts.",
    params: ["amount: u64"],
  },
  {
    name: "toggle_pause(paused)",
    role: "admin",
    purpose: "Pauses or resumes investor actions when admin actions are not locked.",
    params: ["paused: bool"],
  },
  {
    name: "set_admin_actions_lock(unlock_timestamp)",
    role: "admin",
    purpose: "Locks sensitive admin controls until a future Unix timestamp.",
    params: ["unlock_timestamp: i64"],
  },
  {
    name: "finalize_presale() / withdraw_funds() / withdraw_unsold()",
    role: "admin",
    purpose: "Closes the sale after end time, sends raised SOL to treasury if soft cap is met, and returns unsold tokens.",
    params: ["no instruction parameters"],
  },
  {
    name: "initialize_staking(reward_rate_per_second)",
    role: "admin",
    purpose: "Creates the staking pool and reward vault for the configured presale token.",
    params: ["reward_rate_per_second: u64"],
  },
  {
    name: "fund_reward_vault(amount)",
    role: "admin",
    purpose: "Moves reward tokens from admin ATA into the reward vault.",
    params: ["amount: u64"],
  },
  {
    name: "buy_tokens(sol_amount, referrer)",
    role: "investor",
    purpose: "Buys tokens from the current stage, records vesting, and optionally pays a referral bonus.",
    params: ["sol_amount: u64", "referrer: Option<Pubkey>"],
  },
  {
    name: "claim_vested() / claim_refund()",
    role: "investor",
    purpose: "Claims unlocked vested tokens when soft cap is met, or refunds SOL when the sale fails.",
    params: ["no instruction parameters"],
  },
  {
    name: "stake(amount) / unstake(amount) / claim_rewards()",
    role: "investor",
    purpose: "Manages an investor staking position and claims available rewards.",
    params: ["amount: u64 for stake and unstake", "no parameters for claim_rewards"],
  },
];

function asPkString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (value && typeof value === "object" && typeof (value as any).toBase58 === "function") {
    try {
      return (value as any).toBase58();
    } catch {
      return "";
    }
  }
  return "";
}

function toPk(value: unknown): PublicKey | null {
  const normalized = asPkString(value);
  if (!normalized) return null;
  try {
    return new PublicKey(normalized.trim());
  } catch {
    return null;
  }
}

function getField<T>(obj: any, keys: string[], fallback: T): T {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) {
      return obj[k] as T;
    }
  }
  return fallback;
}

function FieldNote({ children }: { children: React.ReactNode }) {
  return <div className="field-note">{children}</div>;
}

function rawErrorMessage(err: unknown): string {
  const asAny = err as any;
  return String(asAny?.error?.errorMessage || asAny?.message || asAny?.toString?.() || "Unknown error");
}

function getActionErrorNotice(label: string, err: unknown): Notice {
  const message = rawErrorMessage(err);

  if (
    label === "Initialize presale" &&
    (message.includes("already in use") || message.includes("Allocate: account"))
  ) {
    return {
      kind: "error",
      text: "Presale is already initialized for this admin wallet.",
      hints: [
        "Use 'Load On-chain State' to refresh the current deployment.",
        "Continue to 'Fund Sale Vault' and 'Manage Sale' instead of initializing again.",
      ],
    };
  }

  // Local validator/runtime combinations can fail Token-2022 metadata realloc.
  // Surface recovery steps instead of a raw simulation dump.
  if (
    label === "Create token" &&
    (
      message.includes("Failed to reallocate account data") ||
      message.includes("MetadataPointerInstruction::Initialize") ||
      message.includes("TokenMetadataInstruction: Initialize") ||
      message.includes("CreateMetadataAccountV3") ||
      message.includes("MetadataError")
    )
  ) {
    return {
      kind: "error",
      text: "Token mint was not created because Metaplex metadata initialization failed.",
      hints: [
        "Retry once; this can be transient on local validator state.",
        "If it repeats, restart your local validator with a clean ledger and try again.",
        "For production-like behavior, verify this flow on devnet with the same program build.",
      ],
    };
  }

  return { kind: "error", text: humanizeError(err) };
}

function decodeMetadataLikeStrings(data: Buffer): { name: string; symbol: string; imageUrl: string; description: string } {
  const values: string[] = [];
  for (let i = 0; i < data.length - 4; i += 1) {
    const len = data.readUInt32LE(i);
    if (len <= 0 || len > 256 || i + 4 + len > data.length) continue;
    const candidate = data.subarray(i + 4, i + 4 + len).toString("utf8").replace(/\u0000/g, "").trim();
    if (!candidate) continue;
    if (/^[\x00-\x1f\x7f]+$/.test(candidate)) continue;
    values.push(candidate);
  }

  const uri = values.find((value) => /^(https?:\/\/|ipfs:\/\/)/i.test(value)) ?? "";
  const symbol = values.find((value) => value.length > 1 && value.length <= 12 && /^[A-Za-z0-9._-]+$/.test(value) && value !== uri) ?? "";
  const description = values.find((value) => value.length > 12 && value.length <= 200 && value !== uri && value !== symbol) ?? "";
  const name = values.find((value) => value.length > 1 && value.length <= 64 && value !== uri && value !== symbol && value !== description) ?? "";

  return { name, symbol, imageUrl: uri, description };
}

function normalizeAssetUri(uri: string): string {
  const value = uri.trim();
  if (!value) return "";
  if (/^ipfs:\/\//i.test(value)) {
    return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\//i, "")}`;
  }
  return value;
}

async function loadProfileFromUri(uri: string): Promise<{ name?: string; symbol?: string; imageUrl?: string; description?: string }> {
  const resolved = normalizeAssetUri(uri);
  if (!resolved) return {};

  try {
    const res = await fetch(resolved, { cache: "no-store" });
    if (!res.ok) return {};

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const looksJson = contentType.includes("application/json") || resolved.toLowerCase().endsWith(".json");
    if (!looksJson) {
      return { imageUrl: resolved };
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const imageCandidate = typeof payload.image === "string"
      ? payload.image
      : typeof payload.image_url === "string"
        ? payload.image_url
        : "";

    return {
      name: typeof payload.name === "string" ? payload.name : undefined,
      symbol: typeof payload.symbol === "string" ? payload.symbol : undefined,
      description: typeof payload.description === "string" ? payload.description : undefined,
      imageUrl: imageCandidate ? normalizeAssetUri(imageCandidate) : undefined,
    };
  } catch {
    return {};
  }
}

function ContractReference({ mode }: { mode: ConsoleMode }) {
  const actions = CONTRACT_ACTIONS.filter((action) => action.role === mode || action.role === "shared");
  return (
    <details className="reference-panel" aria-label={`${mode} smart contract reference`}>
      <summary className="reference-summary">
        <div>
          <span className="section-kicker">Technical reference</span>
          <h2>{mode === "admin" ? "Admin functions and exact parameters" : "Investor functions and exact parameters"}</h2>
          <p>
            The app derives program accounts automatically. Open this only when debugging a transaction or matching the UI to the contract.
          </p>
        </div>
        <span className="reference-count">{actions.length} flows</span>
      </summary>
      <div className="reference-grid">
        {actions.map((action) => (
          <article className="reference-item" key={action.name}>
            <h3>{action.name}</h3>
            <p>{action.purpose}</p>
            <div className="param-list">
              {action.params.map((param) => (
                <code key={param}>{param}</code>
              ))}
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}

export default function PresaleConsole({ mode }: { mode: ConsoleMode }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [navOpen, setNavOpen] = useState(false);
  const [sharedHydrated, setSharedHydrated] = useState(false);

  const [adminInput, setAdminInput] = useState("");
  const [mintInput, setMintInput] = useState("");
  const [treasuryInput, setTreasuryInput] = useState("");

  const [stateData, setStateData] = useState<any>(null);
  const [poolData, setPoolData] = useState<any>(null);
  const [vestingData, setVestingData] = useState<any>(null);
  const [userStakeData, setUserStakeData] = useState<any>(null);
  const [tokenVaultBalanceRaw, setTokenVaultBalanceRaw] = useState<bigint>(0n);
  const [mintDecimals, setMintDecimals] = useState<number>(6);

  const [createDecimals, setCreateDecimals] = useState("6");
  const [createSupply, setCreateSupply] = useState("1000000");
  const [createCreator, setCreateCreator] = useState("");

  const [softCapSol, setSoftCapSol] = useState("10");
  const [hardCapSol, setHardCapSol] = useState("30");
  const [maxWalletSol, setMaxWalletSol] = useState("5");
  const [tokensForSale, setTokensForSale] = useState("1000000");
  const [startIso, setStartIso] = useState("");
  const [endIso, setEndIso] = useState("");
  const [vestingDurationSecs, setVestingDurationSecs] = useState("2592000");
  const [vestingCliffSecs, setVestingCliffSecs] = useState("604800");
  const [minClaimTokens, setMinClaimTokens] = useState("10");
  const [refBps, setRefBps] = useState("500");
  const [tokenName, setTokenName] = useState("Launch Coin");
  const [tokenSymbol, setTokenSymbol] = useState("LC");
  const [tokenImageUrl, setTokenImageUrl] = useState("https://ipfs.io/ipfs/QmExample");
  const [tokenDescription, setTokenDescription] = useState("Community launch token");
  const [stages, setStages] = useState<StageInput[]>([
    { priceSol: "0.05", tokens: "500000" },
    { priceSol: "0.1", tokens: "500000" },
  ]);

  const [fundPresaleTokens, setFundPresaleTokens] = useState("1000000");
  const [buySol, setBuySol] = useState("1");
  const [buyReferrer, setBuyReferrer] = useState("");

  const [paused, setPaused] = useState("true");
  const [adminLockIso, setAdminLockIso] = useState("");

  const [rewardRateTokensPerSec, setRewardRateTokensPerSec] = useState("0.1");
  const [fundRewardTokens, setFundRewardTokens] = useState("100000");
  const [stakeTokens, setStakeTokens] = useState("100");
  const [unstakeTokens, setUnstakeTokens] = useState("50");

  // Guided-step navigation state.
  const [adminStep, setAdminStep] = useState(0);
  const [investorStep, setInvestorStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).Buffer = (window as any).Buffer || Buffer;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SHARED_INPUTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { admin?: unknown; mint?: unknown; treasury?: unknown };
        setAdminInput(asPkString(parsed.admin));
        setMintInput(asPkString(parsed.mint));
        setTreasuryInput(asPkString(parsed.treasury));
      }
    } catch {
      // Ignore malformed local storage payloads.
    } finally {
      setSharedHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (sharedHydrated && wallet?.publicKey && !adminInput) {
      setAdminInput(wallet.publicKey.toBase58());
    }
  }, [wallet, adminInput, sharedHydrated]);

  useEffect(() => {
    if (!sharedHydrated || typeof window === "undefined") return;
    const payload = {
      admin: asPkString(adminInput).trim(),
      mint: asPkString(mintInput).trim(),
      treasury: asPkString(treasuryInput).trim(),
    };
    window.localStorage.setItem(SHARED_INPUTS_KEY, JSON.stringify(payload));
  }, [adminInput, mintInput, treasuryInput, sharedHydrated]);

  useEffect(() => {
    if (mode !== "admin") return;
    if (startIso && endIso) return;

    const now = Math.floor(Date.now() / 1000);
    const defaultStart = now + SAFE_START_OFFSET_SECONDS;
    const defaultEnd = defaultStart + DEFAULT_SALE_DURATION_SECONDS;

    if (!startIso) setStartIso(unixToIso(String(defaultStart)));
    if (!endIso) setEndIso(unixToIso(String(defaultEnd)));
  }, [mode, startIso, endIso]);

  useEffect(() => {
    if (!notice) return;
    const timeoutMs = notice.kind === "ok" ? 6000 : 9000;
    const timeoutId = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const adminPk = useMemo(() => toPk(adminInput), [adminInput]);
  const statePk = useMemo(() => (adminPk ? deriveState(adminPk) : null), [adminPk]);
  const mintPk = useMemo(() => toPk(mintInput), [mintInput]);
  const treasuryPk = useMemo(() => toPk(treasuryInput), [treasuryInput]);
  const stateAdminPk = useMemo(() => {
    const raw = getField<any>(stateData, ["admin"], "");
    return raw ? toPk(raw) : null;
  }, [stateData]);
  const isConnectedAdmin = useMemo(() => {
    if (!wallet?.publicKey) return false;
    if (stateAdminPk) return wallet.publicKey.equals(stateAdminPk);
    if (adminPk) return wallet.publicKey.equals(adminPk);
    return false;
  }, [wallet, stateAdminPk, adminPk]);

  useEffect(() => {
    if (mode !== "investor") return;
    if (!wallet || !adminPk || !statePk) return;
    void refreshState();
  }, [mode, wallet, adminPk, statePk]);

  const cluster = process.env.NEXT_PUBLIC_CLUSTER || "devnet";
  const explorerBase = `https://explorer.solana.com/tx?cluster=${cluster}`;
  const createDecimalsNum = Number(createDecimals);
  const createSupplyNum = Number(createSupply);
  const canCreateTokenInputs =
    tokenName.trim().length > 0 &&
    tokenSymbol.trim().length > 0 &&
    tokenImageUrl.trim().length > 0 &&
    Number.isInteger(createDecimalsNum) &&
    createDecimalsNum >= 0 &&
    createDecimalsNum <= 255 &&
    Number.isFinite(createSupplyNum) &&
    createSupplyNum > 0 &&
    (!createCreator.trim() || !!toPk(createCreator));
  const startTsPreview = isoToUnix(startIso);
  const endTsPreview = isoToUnix(endIso);
  const vestingDurationNum = Number(vestingDurationSecs);
  const vestingCliffNum = Number(vestingCliffSecs);
  const hasValidStagesInput =
    stages.length > 0 &&
    stages.length <= 5 &&
    stages.every((s) => Number.isFinite(Number(s.priceSol)) && Number(s.priceSol) > 0 && Number.isFinite(Number(s.tokens)) && Number(s.tokens) > 0);
  const canInitializePresaleInputs =
    !!mintPk &&
    !!treasuryPk &&
    startTsPreview > 0n &&
    endTsPreview > startTsPreview &&
    Number.isInteger(vestingDurationNum) &&
    vestingDurationNum >= MIN_VESTING_DURATION_SECONDS &&
    Number.isInteger(vestingCliffNum) &&
    vestingCliffNum >= MIN_VESTING_CLIFF_SECONDS &&
    vestingCliffNum <= vestingDurationNum &&
    hasValidStagesInput;
  const fundVaultAmountRaw = toTokenAmount(fundPresaleTokens, mintDecimals);
  const presaleStartUnix = Number(getField<any>(stateData, ["startTime", "start_time"], 0));
  const presaleStarted = !!stateData && presaleStartUnix > 0 && Date.now() / 1000 >= presaleStartUnix;
  const canFundVaultInputs = !!mintPk && fundVaultAmountRaw > 0n && !presaleStarted;
  const canInitializeAndFundInputs = canInitializePresaleInputs && fundVaultAmountRaw > 0n;
  const vaultFunded = tokenVaultBalanceRaw > 0n;

  // ----------------------------------------------------------------------
  // Derived "guide" state: which steps are complete so the UI stays linear.
  // ----------------------------------------------------------------------
  const presaleActive = getField<boolean>(stateData, ["isActive", "is_active"], false);
  const presalePaused = getField<boolean>(stateData, ["isPaused", "is_paused"], false);
  const presaleEnded =
    !!stateData && !presaleActive && Date.now() / 1000 > Number(getField<any>(stateData, ["endTime", "end_time"], 0));

  const guide = useMemo(() => {
    const steps = (mode === "admin"
      ? [
          { id: 0, label: "Deployer & Treasury", blurb: "Connect wallet, set admin and treasury." },
          { id: 1, label: "Create Token", blurb: "Deploy the mint and supply." },
          { id: 2, label: "Configure Sale", blurb: "Set timing, caps, stages and metadata." },
          { id: 3, label: "Fund Sale Vault", blurb: "Move sale tokens into the vault." },
          { id: 4, label: "Manage Sale", blurb: "Pause, lock and finalize the sale." },
          { id: 5, label: "Withdraw & Staking", blurb: "Settle proceeds and set up rewards." },
        ]
      : [
          { id: 0, label: "Overview", blurb: "Token profile and your balance." },
          { id: 1, label: "Buy Tokens", blurb: "Purchase from the current stage." },
          { id: 2, label: "Claim", blurb: "Claim vested tokens or refund." },
          { id: 3, label: "Stake", blurb: "Earn rewards on your tokens." },
        ]) as { id: number; label: string; blurb: string }[];

    // Determine which admin steps are already satisfied by on-chain state.
    let adminDone = 0;
    if (isConnectedAdmin) adminDone = 1;
    if (isConnectedAdmin && mintPk) adminDone = 2;
    if (stateData) adminDone = 3;
    if (stateData && vaultFunded) adminDone = 4;
    if (presaleEnded) adminDone = 6;

    // Admin follows a strict order. Investors may jump between any action,
    // so leave their progress unmarked (done = 0).
    const investorDone = 0;

    return { steps, done: mode === "admin" ? adminDone : investorDone };
  }, [mode, stateData, isConnectedAdmin, mintPk, vaultFunded, presaleEnded]);

  const adminMaxStep = useMemo(() => {
    if (mode !== "admin") return 3;
    if (!isConnectedAdmin) return 0;
    if (!mintPk) return 1;
    if (!stateData) return 2;
    if (!vaultFunded) return 3;
    if (!presaleEnded) return 4;
    return 5;
  }, [mode, isConnectedAdmin, mintPk, stateData, vaultFunded, presaleEnded]);

  async function getChainNowUnix(): Promise<number> {
    let chainNow = Math.floor(Date.now() / 1000);
    try {
      const slot = await connection.getSlot("confirmed");
      const blockTime = await connection.getBlockTime(slot);
      if (blockTime) chainNow = blockTime;
    } catch {
      // Fall back to local clock if RPC time is temporarily unavailable.
    }
    return chainNow;
  }

  async function refreshState() {
    if (!wallet || !adminPk || !statePk) return;

    let program;
    try {
      program = getProgram(connection, wallet);
    } catch (err) {
      setNotice({ kind: "error", text: humanizeError(err) });
      return;
    }

    try {
      const state = await (program.account as any).presaleState.fetch(statePk);
      setNotice((current) => (current?.text === NO_PRESALE_NOTICE ? null : current));
      setStateData(state);

      const stateMint = asPkString(getField<any>(state, ["tokenMint", "token_mint"], ""));
      let nextName = getField<string>(state, ["tokenName", "token_name"], tokenName);
      let nextSymbol = getField<string>(state, ["tokenSymbol", "token_symbol"], tokenSymbol);
      let nextImageUrl = getField<string>(state, ["tokenImageUrl", "token_image_url"], tokenImageUrl);
      let nextDescription = getField<string>(state, ["tokenDescription", "token_description"], tokenDescription);

      if (stateMint) {
        setMintInput(stateMint);
        const mint = await getMint(connection, new PublicKey(stateMint), "confirmed", TOKEN_PROGRAM_ID);
        setMintDecimals(mint.decimals);

        try {
          const metadataPda = deriveMetadataPda(new PublicKey(stateMint));
          const metadataAccount = await connection.getAccountInfo(metadataPda, "confirmed");
          if (metadataAccount?.data) {
            const decoded = decodeMetadataLikeStrings(metadataAccount.data);
            nextName = decoded.name || nextName;
            nextSymbol = decoded.symbol || nextSymbol;
            nextImageUrl = decoded.imageUrl || nextImageUrl;
            nextDescription = decoded.description || nextDescription;
          }
        } catch {
          // Fall back to the state values when metadata cannot be read from the account.
        }
      }

      if (nextImageUrl) {
        const profile = await loadProfileFromUri(nextImageUrl);
        nextName = profile.name || nextName;
        nextSymbol = profile.symbol || nextSymbol;
        nextDescription = profile.description || nextDescription;
        nextImageUrl = profile.imageUrl || normalizeAssetUri(nextImageUrl);
      }

      setTokenName(nextName);
      setTokenSymbol(nextSymbol);
      setTokenImageUrl(nextImageUrl);
      setTokenDescription(nextDescription);

      const poolPk = deriveStakePool(statePk);
      try {
        const pool = await (program.account as any).stakePool.fetch(poolPk);
        setPoolData(pool);
      } catch {
        setPoolData(null);
      }

      const vestingPk = deriveVesting(wallet.publicKey);
      try {
        const vesting = await (program.account as any).userVesting.fetch(vestingPk);
        setVestingData(vesting);
      } catch {
        setVestingData(null);
      }

      const userStakePk = deriveUserStake(wallet.publicKey);
      try {
        const uStake = await (program.account as any).userStake.fetch(userStakePk);
        setUserStakeData(uStake);
      } catch {
        setUserStakeData(null);
      }

      try {
        const vaultPk = deriveTokenVault(statePk);
        const vaultBalance = await connection.getTokenAccountBalance(vaultPk, "confirmed");
        setTokenVaultBalanceRaw(BigInt(vaultBalance.value.amount));
      } catch {
        setTokenVaultBalanceRaw(0n);
      }
    } catch (err) {
      // A fresh deployment has no state account yet, which is expected.
      // Show a friendly hint instead of a cryptic "account does not exist" error.
      if (String((err as any)?.message ?? err).includes("Account does not exist")) {
        setStateData(null);
        setPoolData(null);
        setVestingData(null);
        setUserStakeData(null);
        setTokenVaultBalanceRaw(0n);
        setNotice({
          kind: "error",
          text: NO_PRESALE_NOTICE,
        });
        return;
      }
      setTokenVaultBalanceRaw(0n);
      setNotice({ kind: "error", text: humanizeError(err) });
    }
  }

  async function runAction(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setNotice(null);
    try {
      const sig = await fn();
      setNotice({ kind: "ok", text: "Action completed successfully.", signature: sig });
      await refreshState();
    } catch (err) {
      setNotice(getActionErrorNotice(label, err));
    } finally {
      setBusy("");
    }
  }

  async function runAdminAction(label: string, fn: () => Promise<string>) {
    if (!isConnectedAdmin) {
      setNotice({
        kind: "error",
        text: "Admin wallet required. Connect the admin wallet configured in the state before using admin actions.",
      });
      return;
    }
    await runAction(label, fn);
  }

  function requireWalletAndCore(): { walletPk: PublicKey; state: PublicKey; program: any } {
    if (!wallet?.publicKey) throw new Error("Please connect your wallet first.");
    if (!statePk) throw new Error("Enter a valid admin wallet to derive the presale state.");
    return {
      walletPk: wallet.publicKey,
      state: statePk,
      program: getProgram(connection, wallet),
    };
  }

  async function createTokenMint(): Promise<{ mint: PublicKey; signature: string; decimals: number }> {
    const ctx = requireWalletAndCore();
    const mint = Keypair.generate();
    const [mintAuthority] = PublicKey.findProgramAddressSync([Buffer.from(MINT_AUTHORITY_SEED)], PROGRAM_ID);
    const metadata = deriveMetadataPda(mint.publicKey);
    const adminAta = deriveAta(ctx.walletPk, mint.publicKey);
    const name = tokenName.trim();
    const symbol = tokenSymbol.trim();
    const imageUrl = tokenImageUrl.trim();
    const description = tokenDescription.trim();

    if (!name) throw new Error("Token name is required.");
    if (!symbol) throw new Error("Token symbol is required.");
    if (!imageUrl) throw new Error("Image URL is required.");

    const decimals = Number(createDecimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error("Decimals must be a whole number between 0 and 255.");
    }

    let creator: PublicKey | null = null;
    if (createCreator.trim()) {
      creator = new PublicKey(createCreator.trim());
    }

    const supplyRaw = toTokenAmount(createSupply, decimals);
    if (supplyRaw <= 0n) {
      throw new Error("Total supply must be greater than zero.");
    }

    const sig = await ctx.program.methods
      .createToken(
        decimals,
        new BN(supplyRaw.toString()),
        creator,
        name,
        symbol,
        imageUrl,
        description,
      )
      .accounts({
        mint: mint.publicKey,
        mintAuthority,
        metadata,
        metadataProgram: METADATA_PROGRAM_ID,
        adminTokenAccount: adminAta,
        admin: ctx.walletPk,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mint])
      .rpc();

    setMintInput(mint.publicKey.toBase58());
    setMintDecimals(decimals);
    return { mint: mint.publicKey, signature: sig, decimals };
  }

  async function createToken() {
    return (await createTokenMint()).signature;
  }

  function applyMinimumValidTiming() {
    const now = Math.floor(Date.now() / 1000);
    const start = now + SAFE_START_OFFSET_SECONDS;
    const end = start + UI_SAFE_MIN_SALE_DURATION_SECONDS;

    setStartIso(unixToIso(String(start)));
    setEndIso(unixToIso(String(end)));
    setVestingDurationSecs(String(MIN_VESTING_DURATION_SECONDS));
    setVestingCliffSecs(String(MIN_VESTING_CLIFF_SECONDS));
  }

  async function createTokenAndAdvance() {
    await runAdminAction("Create token", async () => {
      const result = await createTokenMint();
      setActiveStep(2);
      setCreateDecimals(String(result.decimals));
      return result.signature;
    });
  }

  async function initializePresaleForMint(presaleMint: PublicKey, decimals: number) {
    const ctx = requireWalletAndCore();
    if (!treasuryPk) throw new Error("Enter a valid treasury wallet address.");

    const existingStateAccount = await connection.getAccountInfo(ctx.state, "confirmed");
    if (existingStateAccount) {
      await refreshState();
      setActiveStep(3);
      throw new Error("Presale already initialized for this admin wallet. Continuing to funding and management steps.");
    }

    const startTs = isoToUnix(startIso);
    const endTs = isoToUnix(endIso);
    if (startTs <= 0n || endTs <= 0n) {
      throw new Error("Start and end times are required. Use 'Apply Minimum Valid Values' to auto-fill valid timestamps.");
    }

    const vestingDurationNum = Number(vestingDurationSecs);
    const vestingCliffNum = Number(vestingCliffSecs);
    if (!Number.isInteger(vestingDurationNum) || vestingDurationNum < MIN_VESTING_DURATION_SECONDS) {
      throw new Error(`Vesting duration must be an integer >= ${MIN_VESTING_DURATION_SECONDS}.`);
    }
    if (!Number.isInteger(vestingCliffNum) || vestingCliffNum < MIN_VESTING_CLIFF_SECONDS || vestingCliffNum > vestingDurationNum) {
      throw new Error("Vesting cliff must be an integer between 0 and vesting duration.");
    }

    const chainNow = await getChainNowUnix();

    if (Number(startTs) <= chainNow) {
      throw new Error(`Start must be in the future relative to chain time. Set it at least ${SAFE_START_OFFSET_SECONDS} seconds ahead.`);
    }
    if (Number(endTs) <= Number(startTs)) {
      throw new Error("End time must be later than start time.");
    }

    const tokenVault = deriveTokenVault(ctx.state);
    const solVault = deriveSolVault(ctx.state);
    const vaultPda = deriveVaultAuthority(ctx.state);

    const stageArgs = stages.map((s) => ({
      pricePerToken: new BN(toLamports(s.priceSol).toString()),
      tokensAvailable: new BN(toTokenAmount(s.tokens, decimals).toString()),
      tokensSoldInStage: new BN(0),
    }));

    return ctx.program.methods
      .initializePresale(
        new BN(toLamports(softCapSol).toString()),
        new BN(toLamports(hardCapSol).toString()),
        new BN(toLamports(maxWalletSol).toString()),
        new BN(toTokenAmount(tokensForSale, decimals).toString()),
        new BN(startTs.toString()),
        new BN(endTs.toString()),
        new BN(vestingDurationSecs),
        new BN(vestingCliffSecs),
        new BN(toTokenAmount(minClaimTokens, decimals).toString()),
        Number(refBps),
        tokenName.trim(),
        tokenSymbol.trim(),
        tokenImageUrl.trim(),
        tokenDescription.trim(),
        stageArgs,
      )
      .accounts({
        state: ctx.state,
        mint: presaleMint,
        tokenVault,
        vaultPda,
        solVault,
        admin: ctx.walletPk,
        treasury: treasuryPk,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function initializePresale() {
    if (!mintPk) throw new Error("Enter a valid token mint address.");
    return initializePresaleForMint(mintPk, mintDecimals);
  }

  async function initializeAndFundPresale() {
    if (!mintPk) throw new Error("Enter a valid token mint address.");
    await initializePresaleForMint(mintPk, mintDecimals);
    const fundSig = await fundPresaleVaultForMint(mintPk, mintDecimals);
    setActiveStep(4);
    return fundSig;
  }

  async function fundPresaleVaultForMint(presaleMint: PublicKey, decimals: number) {
    const ctx = requireWalletAndCore();
    const stateAccount = await connection.getAccountInfo(ctx.state, "confirmed");
    if (!stateAccount) {
      throw new Error("Initialize presale first before funding the vault.");
    }

    let startUnix = 0;
    try {
      const program = getProgram(connection, wallet!);
      const onchainState = await (program.account as any).presaleState.fetch(ctx.state);
      startUnix = Number(getField<any>(onchainState, ["startTime", "start_time"], 0));
    } catch {
      // If decode fails, continue with 0 so on-chain check remains authoritative.
    }

    const nowUnix = await getChainNowUnix();
    if (startUnix > 0 && nowUnix >= startUnix) {
      throw new Error("Fund vault must be done before presale start time. This presale has already started.");
    }
    if (toTokenAmount(fundPresaleTokens, decimals) <= 0n) {
      throw new Error("Tokens to fund must be greater than zero.");
    }

    return ctx.program.methods
      .fundPresaleVault(new BN(toTokenAmount(fundPresaleTokens, decimals).toString()))
      .accounts({
        state: ctx.state,
        admin: ctx.walletPk,
        adminTokenAccount: deriveAta(ctx.walletPk, presaleMint),
        mint: presaleMint,
        vault: deriveTokenVault(ctx.state),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async function fundPresaleVault() {
    if (!mintPk) throw new Error("Enter a valid token mint address.");
    return fundPresaleVaultForMint(mintPk, mintDecimals);
  }

  async function launchPresale() {
    const token = await createTokenMint();
    await initializePresaleForMint(token.mint, token.decimals);
    const fundSig = await fundPresaleVaultForMint(token.mint, token.decimals);
    return fundSig;
  }

  async function buyTokens() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    const referrerPk = buyReferrer.trim() ? new PublicKey(buyReferrer.trim()) : null;
    const refAta = referrerPk ? deriveAta(referrerPk, mintPk) : deriveAta(ctx.walletPk, mintPk);

    return ctx.program.methods
      .buyTokens(new BN(toLamports(buySol).toString()), referrerPk)
      .accounts({
        state: ctx.state,
        buyer: ctx.walletPk,
        solVault: deriveSolVault(ctx.state),
        mint: mintPk,
        vault: deriveTokenVault(ctx.state),
        vaultPda: deriveVaultAuthority(ctx.state),
        vesting: deriveVesting(ctx.walletPk),
        referrerTokenAccount: refAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async function claimVested() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .claimVested()
      .accounts({
        state: ctx.state,
        vesting: deriveVesting(ctx.walletPk),
        user: ctx.walletPk,
        mint: mintPk,
        vault: deriveTokenVault(ctx.state),
        vaultPda: deriveVaultAuthority(ctx.state),
        userTokenAccount: deriveAta(ctx.walletPk, mintPk),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function claimRefund() {
    const ctx = requireWalletAndCore();
    return ctx.program.methods
      .claimRefund()
      .accounts({
        state: ctx.state,
        vesting: deriveVesting(ctx.walletPk),
        user: ctx.walletPk,
        solVault: deriveSolVault(ctx.state),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function togglePause() {
    const ctx = requireWalletAndCore();
    return ctx.program.methods.togglePause(paused === "true").accounts({ state: ctx.state, admin: ctx.walletPk }).rpc();
  }

  async function finalizePresale() {
    const ctx = requireWalletAndCore();
    return ctx.program.methods.finalizePresale().accounts({ state: ctx.state, admin: ctx.walletPk }).rpc();
  }

  async function withdrawFunds() {
    const ctx = requireWalletAndCore();
    if (!stateData) throw new Error("Load the on-chain state first.");
    const treasury = new PublicKey(getField(stateData, ["treasury"], ""));

    return ctx.program.methods
      .withdrawFunds()
      .accounts({
        state: ctx.state,
        solVault: deriveSolVault(ctx.state),
        treasury,
        admin: ctx.walletPk,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function withdrawUnsold() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .withdrawUnsold()
      .accounts({
        state: ctx.state,
        admin: ctx.walletPk,
        mint: mintPk,
        vault: deriveTokenVault(ctx.state),
        vaultPda: deriveVaultAuthority(ctx.state),
        adminAta: deriveAta(ctx.walletPk, mintPk),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function initializeStaking() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .initializeStaking(new BN(toTokenAmount(rewardRateTokensPerSec, mintDecimals).toString()))
      .accounts({
        state: ctx.state,
        pool: deriveStakePool(ctx.state),
        admin: ctx.walletPk,
        mint: mintPk,
        stakeVault: deriveStakeVault(ctx.state),
        rewardVault: deriveRewardVault(ctx.state),
        vaultPda: deriveVaultAuthority(ctx.state),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function fundRewardVault() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .fundRewardVault(new BN(toTokenAmount(fundRewardTokens, mintDecimals).toString()))
      .accounts({
        state: ctx.state,
        pool: deriveStakePool(ctx.state),
        admin: ctx.walletPk,
        mint: mintPk,
        adminTokenAccount: deriveAta(ctx.walletPk, mintPk),
        rewardVault: deriveRewardVault(ctx.state),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async function stake() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .stake(new BN(toTokenAmount(stakeTokens, mintDecimals).toString()))
      .accounts({
        state: ctx.state,
        pool: deriveStakePool(ctx.state),
        userStake: deriveUserStake(ctx.walletPk),
        user: ctx.walletPk,
        mint: mintPk,
        stakeVault: deriveStakeVault(ctx.state),
        userToken: deriveAta(ctx.walletPk, mintPk),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function unstake() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .unstake(new BN(toTokenAmount(unstakeTokens, mintDecimals).toString()))
      .accounts({
        state: ctx.state,
        pool: deriveStakePool(ctx.state),
        userStake: deriveUserStake(ctx.walletPk),
        user: ctx.walletPk,
        mint: mintPk,
        stakeVault: deriveStakeVault(ctx.state),
        rewardVault: deriveRewardVault(ctx.state),
        vaultPda: deriveVaultAuthority(ctx.state),
        userToken: deriveAta(ctx.walletPk, mintPk),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async function claimRewards() {
    const ctx = requireWalletAndCore();
    if (!mintPk) throw new Error("Enter a valid token mint address.");

    return ctx.program.methods
      .claimRewards()
      .accounts({
        state: ctx.state,
        pool: deriveStakePool(ctx.state),
        userStake: deriveUserStake(ctx.walletPk),
        user: ctx.walletPk,
        mint: mintPk,
        rewardVault: deriveRewardVault(ctx.state),
        vaultPda: deriveVaultAuthority(ctx.state),
        userToken: deriveAta(ctx.walletPk, mintPk),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async function setAdminActionsLock() {
    const ctx = requireWalletAndCore();
    return ctx.program.methods
      .setAdminActionsLock(new BN(isoToUnix(adminLockIso).toString()))
      .accounts({ state: ctx.state, admin: ctx.walletPk })
      .rpc();
  }

  const activeStep = mode === "admin" ? adminStep : investorStep;
  const setActiveStep = mode === "admin" ? setAdminStep : setInvestorStep;

  // Compact wallet/status bar reused in each panel.
  const statusRow = (
    <div className="kv status-row">
      <span>Program: {shortPk(PROGRAM_ID.toBase58())}</span>
      <span>Wallet: {wallet?.publicKey ? shortPk(wallet.publicKey.toBase58()) : "not connected"}</span>
      <span>State: {stateData ? (presalePaused ? "paused" : presaleActive ? "active" : "ended") : "not deployed"}</span>
      {statePk && <span>State PDA: {shortPk(statePk.toBase58())}</span>}
    </div>
  );

  return (
    <main className="shell dark-shell">
      <section className="hero dark-hero">
        <div>
          <div className="eyebrow">Presale Command Center</div>
          <h1>{mode === "admin" ? "Launch & manage your presale" : "Join the presale"}</h1>
          <p>
            {mode === "admin"
              ? "Follow the numbered steps in order. Completed steps are marked as you go, so you always know what to do next."
              : "Buy, claim and stake. The app walks you through each step with the right accounts derived automatically."}
          </p>
        </div>
        <div className="hero-actions">
          <nav className="panel-switch desktop-switch" aria-label="Panel switcher">
            <Link href="/admin" className={mode === "admin" ? "active" : ""}>Admin</Link>
            <Link href="/investor" className={mode === "investor" ? "active" : ""}>Investor</Link>
          </nav>
          <button className="drawer-toggle" onClick={() => setNavOpen(true)} aria-label="Open panel navigation">
            Panels
          </button>
          <WalletMultiButton />
        </div>
      </section>

      <div className={`mobile-drawer ${navOpen ? "open" : ""}`} aria-hidden={!navOpen}>
        <button className="drawer-backdrop" onClick={() => setNavOpen(false)} aria-label="Close navigation" />
        <aside className="drawer-panel">
          <div className="drawer-head">
            <strong>Switch Panel</strong>
            <button className="secondary" onClick={() => setNavOpen(false)}>Close</button>
          </div>
          <div className="drawer-links">
            <Link href="/admin" className={mode === "admin" ? "active" : ""} onClick={() => setNavOpen(false)}>
              Admin Panel
            </Link>
            <Link href="/investor" className={mode === "investor" ? "active" : ""} onClick={() => setNavOpen(false)}>
              Investor Panel
            </Link>
          </div>
        </aside>
      </div>

      {/* Guided step navigation */}
      <nav className="guide-steps" aria-label="Workflow steps">
        {guide.steps.map((step) => {
          const isActive = activeStep === step.id;
          const isDone = step.id < guide.done;
          const adminLocked = mode === "admin" && step.id > adminMaxStep;
          return (
            <button
              key={step.id}
              className={`guide-step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
              disabled={adminLocked}
              onClick={() => {
                if (adminLocked) return;
                setActiveStep(step.id);
              }}
            >
              <span className="guide-dot">{isDone ? "✓" : step.id + 1}</span>
              <span className="guide-label">
                <strong>{step.label}</strong>
                <small>{step.blurb}</small>
              </span>
            </button>
          );
        })}
      </nav>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          <div>{notice.text}</div>
          {!!notice.hints?.length && (
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {notice.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          )}
          {notice.signature && (
            <div style={{ marginTop: 6 }}>
              Signature:{" "}
              <a href={`${explorerBase}/${notice.signature}`} target="_blank" rel="noreferrer">
                {shortPk(notice.signature)}
          </a>
            </div>
          )}
        </div>
      )}

      {notice && (
        <div
          className={`notice ${notice.kind}`}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 120,
            width: "min(460px, calc(100vw - 32px))",
            boxShadow: "0 18px 42px rgba(23, 39, 62, 0.22)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{notice.kind === "ok" ? "Action succeeded" : "Action failed"}</strong>
            <button
              className="secondary"
              style={{ width: "auto", minWidth: 0, padding: "4px 8px" }}
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          </div>
          <div style={{ marginTop: 6 }}>{notice.text}</div>
          {!!notice.hints?.length && (
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {notice.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          )}
          {notice.signature && (
            <div style={{ marginTop: 6 }}>
              Signature:{" "}
              <a href={`${explorerBase}/${notice.signature}`} target="_blank" rel="noreferrer">
                {shortPk(notice.signature)}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Shared deployer/connection panel (admin step 0, investor step 0) */}
      {activeStep === 0 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>{mode === "admin" ? "Deployer & Treasury" : "Overview"}</h2>
          <p className="sub">
            {mode === "admin"
              ? "Connect the wallet that will own the presale and choose the treasury that receives raised SOL."
              : "Review the token and your current vesting and staking position."}
          </p>
          <div className="row cols3">
            <div>
              <label>Admin wallet</label>
              <input value={adminInput} onChange={(e) => setAdminInput(e.target.value)} placeholder="Admin public key" />
              <FieldNote>This derives the presale state PDA.</FieldNote>
            </div>
            <div>
              <label>Mint address</label>
              <input value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder="Token mint" />
              <FieldNote>Auto-filled after Create Token or Load On-chain State.</FieldNote>
            </div>
            {mode === "admin" ? (
              <div>
                <label>Treasury wallet</label>
                <input value={treasuryInput} onChange={(e) => setTreasuryInput(e.target.value)} placeholder="Treasury public key" />
                <FieldNote>Receives raised SOL after a successful sale.</FieldNote>
              </div>
            ) : (
              <div>
                <label>Sale status</label>
                <div className="stat-badge" style={{ color: presalePaused ? "var(--danger)" : presaleActive ? "var(--ok)" : "var(--muted)" }}>
                  {stateData ? (presalePaused ? "Paused" : presaleActive ? "Open" : "Ended") : "Not deployed"}
                </div>
                <FieldNote>Refreshed when you load on-chain state.</FieldNote>
              </div>
            )}
          </div>

          {mode === "admin" && (
            <div className="admin-auth">
              {isConnectedAdmin ? (
                <div className="notice ok" style={{ marginTop: 12 }}>
                  Admin wallet connected and authorized.
                </div>
              ) : (
                <div className="notice error" style={{ marginTop: 12 }}>
                  Connect the admin wallet above ({shortPk((stateAdminPk ?? adminPk)?.toBase58())}) to unlock admin actions.
                </div>
              )}
            </div>
          )}

          <div className="auto-account-strip" aria-label="Automatically handled accounts">
            <strong>Auto-created or auto-derived by the app/program:</strong>
            <span>state PDA</span><span>token vault</span><span>SOL vault</span><span>vault authority</span>
            <span>vesting account</span><span>staking pool</span><span>stake vault</span><span>reward vault</span><span>associated token accounts</span>
          </div>
          {statusRow}
          <div style={{ marginTop: 14 }}>
            <button disabled={!wallet || !!busy} onClick={() => runAction("Load state", async () => { await refreshState(); return ""; })}>
              {busy === "Load state" ? "Loading..." : "Load On-chain State"}
            </button>
            {(mode === "admin" ? isConnectedAdmin : !!wallet) && (
              <button
                className="secondary continue-btn"
                onClick={() => setActiveStep(1)}
                disabled={mode === "admin" && !!busy}
              >
                Continue →
              </button>
            )}
          </div>
        </section>
      )}

      {/* Admin step 1: Create Token */}
      {mode === "admin" && activeStep === 1 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Create Token</h2>
          <p className="sub">Fill the token identity first, then create the mint and metadata together so the on-chain metadata is available immediately.</p>
          <div className="row cols3">
            <div><label>Token name</label><input value={tokenName} onChange={(e) => setTokenName(e.target.value)} /></div>
            <div><label>Symbol</label><input value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)} /></div>
            <div><label>Image URL</label><input value={tokenImageUrl} onChange={(e) => setTokenImageUrl(e.target.value)} placeholder="https://..." /></div>
            <div><label>Description</label><input value={tokenDescription} onChange={(e) => setTokenDescription(e.target.value)} /></div>
            <div><label>Decimals</label><input value={createDecimals} onChange={(e) => setCreateDecimals(e.target.value)} /></div>
            <div><label>Total supply (tokens)</label><input value={createSupply} onChange={(e) => setCreateSupply(e.target.value)} /></div>
            <div><label>Creator (optional)</label><input value={createCreator} onChange={(e) => setCreateCreator(e.target.value)} placeholder="Optional public key" /></div>
            <div>
              <label>Mint address</label>
              <input value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder="Filled after creating" readOnly={!!mintInput} />
              <FieldNote>You can also paste an existing mint to skip this step.</FieldNote>
            </div>
          </div>
          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(0)}>← Back</button>
            <button
              disabled={!isConnectedAdmin || !canCreateTokenInputs || !!busy}
              onClick={createTokenAndAdvance}
            >
              {busy === "Create token" ? "Creating..." : "Create Token"}
            </button>
            {mintInput && (
              <button className="continue-btn" onClick={() => { setActiveStep(2); setCreateDecimals(String(mintDecimals)); }}>Continue →</button>
            )}
          </div>
        </section>
      )}

      {/* Admin step 2: Configure Sale / Launch */}
      {mode === "admin" && activeStep === 2 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Configure &amp; Launch the Sale</h2>
          <p className="sub">Set the fundraising target, timing, token allocations and metadata. This creates the state, vaults and stages on-chain.</p>

          {stateData && (
            <div className="notice ok" style={{ marginTop: 10 }}>
              Presale state already exists for this admin. Initialization is disabled to prevent accidental relaunch.
            </div>
          )}

          {stateData && presaleStarted && (
            <div className="notice error" style={{ marginTop: 10 }}>
              Presale already started. Vault funding is closed for this presale.
              Start a new presale with a different admin wallet/state for a fresh launch.
            </div>
          )}

          <div className="step-group">
            <h3>Fundraising</h3>
            <div className="row cols3">
              <div><label>Tokens for sale</label><input value={tokensForSale} onChange={(e) => { setTokensForSale(e.target.value); setFundPresaleTokens(e.target.value); }} /></div>
              <div><label>Soft cap (SOL)</label><input value={softCapSol} onChange={(e) => setSoftCapSol(e.target.value)} /></div>
              <div><label>Hard cap (SOL)</label><input value={hardCapSol} onChange={(e) => setHardCapSol(e.target.value)} /></div>
            </div>
          </div>

          <div className="step-group">
            <h3>Timing</h3>
            <div className="row cols3">
              <div><label>Max wallet (SOL)</label><input value={maxWalletSol} onChange={(e) => setMaxWalletSol(e.target.value)} /></div>
              <div><label>Start</label><input type="datetime-local" value={startIso} onChange={(e) => setStartIso(e.target.value)} /></div>
              <div><label>End</label><input type="datetime-local" value={endIso} onChange={(e) => setEndIso(e.target.value)} /></div>
            </div>
            <div className="notice ok" style={{ marginTop: 10 }}>
              <div><strong>Smart contract minimum timing requirements</strong></div>
              <div>Start must be greater than current chain time (strict minimum: now + {MIN_START_OFFSET_SECONDS}s).</div>
              <div>End must be greater than start time (strict contract minimum: start + {CONTRACT_MIN_SALE_DURATION_SECONDS}s).</div>
              <div>UI-safe minimum for datetime input: start + {UI_SAFE_MIN_SALE_DURATION_SECONDS}s (avoids same-minute rounding issues).</div>
              <div>Vesting duration must be at least {MIN_VESTING_DURATION_SECONDS} second.</div>
              <div>Vesting cliff must be between {MIN_VESTING_CLIFF_SECONDS} and vesting duration.</div>
              <div style={{ marginTop: 8 }}>
                <button className="secondary" style={{ width: "auto" }} onClick={applyMinimumValidTiming}>
                  Apply Minimum Valid Values
                </button>
                <span style={{ marginLeft: 8, color: "#245a48", fontSize: "0.82rem" }}>
                  Uses a +{SAFE_START_OFFSET_SECONDS}s start buffer to avoid edge-case timing failures.
                </span>
              </div>
            </div>
          </div>

          <div className="step-group">
            <h3>Vesting</h3>
            <div className="row cols3">
              <div><label>Vesting duration (seconds)</label><input type="number" min={MIN_VESTING_DURATION_SECONDS} step="1" value={vestingDurationSecs} onChange={(e) => setVestingDurationSecs(e.target.value)} /></div>
              <div><label>Vesting cliff (seconds)</label><input type="number" min={MIN_VESTING_CLIFF_SECONDS} step="1" value={vestingCliffSecs} onChange={(e) => setVestingCliffSecs(e.target.value)} /></div>
              <div><label>Min claim tokens</label><input value={minClaimTokens} onChange={(e) => setMinClaimTokens(e.target.value)} /></div>
            </div>
          </div>

          <div className="step-group">
            <h3>Referrals</h3>
            <div className="row cols3">
              <div><label>Referral bonus (bps)</label><input value={refBps} onChange={(e) => setRefBps(e.target.value)} /></div>
            </div>
          </div>

          <div className="step-group">
            <h3>Pricing Stages</h3>
            {stages.map((s, i) => (
              <div className="row cols3" key={i} style={{ marginBottom: 8 }}>
                <div><label>Stage {i + 1} price (SOL)</label><input value={s.priceSol} onChange={(e) => { const next = [...stages]; next[i] = { ...next[i], priceSol: e.target.value }; setStages(next); }} /></div>
                <div><label>Stage {i + 1} tokens</label><input value={s.tokens} onChange={(e) => { const next = [...stages]; next[i] = { ...next[i], tokens: e.target.value }; setStages(next); }} /></div>
                <div style={{ display: "flex", alignItems: "end" }}><button className="secondary" disabled={stages.length <= 1} onClick={() => setStages(stages.filter((_, idx) => idx !== i))}>Remove</button></div>
              </div>
            ))}
            <button className="secondary" disabled={stages.length >= 5} onClick={() => setStages([...stages, { priceSol: "0.1", tokens: "100000" }])}>Add Stage</button>
          </div>

          <div className="step-group">
            <h3>Fund Vault (Same Section)</h3>
            <div className="row cols3">
              <div>
                <label>Tokens to fund</label>
                <input value={fundPresaleTokens} onChange={(e) => setFundPresaleTokens(e.target.value)} />
                <FieldNote>This is the amount transferred from admin ATA into the sale vault.</FieldNote>
              </div>
            </div>
            <div className="action-buttons">
              {!stateData ? (
                <button
                  disabled={!isConnectedAdmin || !canInitializeAndFundInputs || !!busy}
                  onClick={() => runAdminAction("Initialize + fund vault", initializeAndFundPresale)}
                >
                  {busy === "Initialize + fund vault" ? "Launching..." : "Initialize + Fund Vault"}
                </button>
              ) : (
                <button
                  disabled={!isConnectedAdmin || !canFundVaultInputs || !!busy}
                  onClick={() => runAdminAction("Fund presale vault", fundPresaleVault)}
                >
                  {busy === "Fund presale vault" ? "Funding..." : "Fund Vault Now"}
                </button>
              )}
            </div>
          </div>

          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(1)}>← Back</button>
            {!stateData ? (
              <button
                disabled={!isConnectedAdmin || !canInitializeAndFundInputs || !!busy}
                onClick={() => runAdminAction("Initialize + fund vault", initializeAndFundPresale)}
              >
                {busy === "Initialize + fund vault" ? "Launching..." : "Initialize + Fund Vault"}
              </button>
            ) : (
              <button
                disabled={!isConnectedAdmin || !canFundVaultInputs || !!busy}
                onClick={() => runAdminAction("Fund presale vault", fundPresaleVault)}
              >
                {busy === "Fund presale vault" ? "Funding..." : "Fund Vault Now"}
              </button>
            )}
            {stateData && <button className="continue-btn" onClick={() => setActiveStep(3)}>Continue →</button>}
          </div>
        </section>
      )}

      {/* Admin step 3: Fund Sale Vault */}
      {mode === "admin" && activeStep === 3 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Fund the Sale Vault</h2>
          <p className="sub">Move the tokens that investors will buy into the presale vault. This is required before purchases can settle.</p>
          <div className="row cols3">
            <div>
              <label>Tokens to fund</label>
              <input value={fundPresaleTokens} onChange={(e) => setFundPresaleTokens(e.target.value)} />
              <FieldNote>Transfer from your wallet into the vault.</FieldNote>
            </div>
          </div>
          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(2)}>← Back</button>
            <button
              disabled={!isConnectedAdmin || !canFundVaultInputs || !!busy}
              onClick={() => runAdminAction("Fund presale vault", fundPresaleVault)}
            >
              {busy === "Fund presale vault" ? "Funding..." : "Fund Vault"}
            </button>
            {stateData && vaultFunded && <button className="continue-btn" onClick={() => setActiveStep(4)}>Continue →</button>}
          </div>
        </section>
      )}

      {/* Admin step 4: Manage Sale */}
      {mode === "admin" && activeStep === 4 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Manage the Live Sale</h2>
          <p className="sub">Pause purchases, time-lock admin controls, or stop the sale when it has ended.</p>
          <div className="row cols2">
            <div>
              <label>Pause state</label>
              <select value={paused} onChange={(e) => setPaused(e.target.value)}>
                <option value="true">Pause</option>
                <option value="false">Unpause</option>
              </select>
              <FieldNote>`paused: bool` for `toggle_pause`.</FieldNote>
            </div>
            <div>
              <label>Lock admin actions until</label>
              <input type="datetime-local" value={adminLockIso} onChange={(e) => setAdminLockIso(e.target.value)} />
              <FieldNote>`unlock_timestamp: i64` for `set_admin_actions_lock`.</FieldNote>
            </div>
          </div>
          <div className="action-buttons">
            <button className="secondary" disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Toggle pause", togglePause)}>Toggle Pause</button>
            <button className="secondary" disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Set lock", setAdminActionsLock)}>Set Admin Lock</button>
            <button className="warn" disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Finalize presale", finalizePresale)}>Finalize Presale</button>
          </div>
          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(3)}>← Back</button>
            {stateData && <button className="continue-btn" onClick={() => setActiveStep(5)}>Continue →</button>}
          </div>
        </section>
      )}

      {/* Admin step 5: Withdraw & Staking */}
      {mode === "admin" && activeStep === 5 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Withdraw &amp; Staking</h2>
          <p className="sub">After the sale ends, withdraw raised SOL and unsold tokens, then set up staking rewards.</p>

          <div className="step-group">
            <h3>Withdraw</h3>
            <div className="action-buttons">
              <button className="warn" disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Withdraw funds", withdrawFunds)}>Withdraw SOL Funds</button>
              <button className="warn" disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Withdraw unsold", withdrawUnsold)}>Withdraw Unsold Tokens</button>
            </div>
          </div>

          <div className="step-group">
            <h3>Set up Staking</h3>
            <div className="row cols2">
              <div>
                <label>Reward rate (tokens/sec)</label>
                <input value={rewardRateTokensPerSec} onChange={(e) => setRewardRateTokensPerSec(e.target.value)} />
                <FieldNote>`reward_rate_per_second: u64` after token decimals.</FieldNote>
              </div>
              <div>
                <label>Reward funding (tokens)</label>
                <input value={fundRewardTokens} onChange={(e) => setFundRewardTokens(e.target.value)} />
                <FieldNote>`amount: u64` for `fund_reward_vault`.</FieldNote>
              </div>
            </div>
            <div className="action-buttons">
              <button disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Initialize staking", initializeStaking)}>Initialize Staking</button>
              <button className="secondary" disabled={!isConnectedAdmin || !!busy} onClick={() => runAdminAction("Fund reward vault", fundRewardVault)}>Fund Reward Vault</button>
            </div>
          </div>

          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(4)}>← Back</button>
          </div>
        </section>
      )}

      {/* Investor step 1: Buy */}
      {mode === "investor" && activeStep === 1 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Buy Tokens</h2>
          <p className="sub">The app derives the sale vaults and creates your vesting account when needed.</p>
          <div className="row cols3">
            <div>
              <label>SOL amount</label>
              <input value={buySol} onChange={(e) => setBuySol(e.target.value)} />
              <FieldNote>`sol_amount: u64` in lamports.</FieldNote>
            </div>
            <div>
              <label>Referrer wallet (optional)</label>
              <input value={buyReferrer} onChange={(e) => setBuyReferrer(e.target.value)} placeholder="Optional public key" />
              <FieldNote>Cannot be your own wallet.</FieldNote>
            </div>
          </div>
          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(0)}>← Back</button>
            <button disabled={!wallet || !!busy} onClick={() => runAction("Buy tokens", buyTokens)}>
              {busy === "Buy tokens" ? "Working..." : "Buy Tokens"}
            </button>
          </div>
        </section>
      )}

      {/* Investor step 2: Claim */}
      {mode === "investor" && activeStep === 2 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Claim Tokens or Refund</h2>
          <p className="sub">Claim unlocked vested tokens when the soft cap is met, or refund your SOL when the sale fails.</p>
          <div className="action-buttons">
            <button disabled={!wallet || !!busy} onClick={() => runAction("Claim vested", claimVested)}>
              {busy === "Claim vested" ? "Working..." : "Claim Vested"}
            </button>
            <button className="secondary" disabled={!wallet || !!busy} onClick={() => runAction("Claim refund", claimRefund)}>
              {busy === "Claim refund" ? "Working..." : "Claim Refund"}
            </button>
          </div>
          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(1)}>← Back</button>
            {!!wallet && <button className="continue-btn" onClick={() => setActiveStep(3)}>Continue →</button>}
          </div>
        </section>
      )}

      {/* Investor step 3: Stake */}
      {mode === "investor" && activeStep === 3 && (
        <section className="card dark-card">
          <span className="section-kicker">Step {activeStep + 1} of {guide.steps.length}</span>
          <h2>Stake &amp; Earn</h2>
          <p className="sub">Stake your tokens to earn rewards, or unstake and claim any available rewards.</p>
          <div className="row cols2">
            <div>
              <label>Stake amount (tokens)</label>
              <input value={stakeTokens} onChange={(e) => setStakeTokens(e.target.value)} />
              <FieldNote>`amount: u64` for `stake`.</FieldNote>
            </div>
            <div>
              <label>Unstake amount (tokens)</label>
              <input value={unstakeTokens} onChange={(e) => setUnstakeTokens(e.target.value)} />
              <FieldNote>`amount: u64` for `unstake`.</FieldNote>
            </div>
          </div>
          <div className="action-buttons">
            <button disabled={!wallet || !!busy} onClick={() => runAction("Stake", stake)}>Stake</button>
            <button className="secondary" disabled={!wallet || !!busy} onClick={() => runAction("Unstake", unstake)}>Unstake</button>
            <button className="secondary" disabled={!wallet || !!busy} onClick={() => runAction("Claim rewards", claimRewards)}>Claim Rewards</button>
          </div>
          <div className="step-controls">
            <button className="secondary" onClick={() => setActiveStep(2)}>← Back</button>
          </div>
        </section>
      )}

      {/* Snapshot panel always visible below the active step */}
      <section className="grid" style={{ marginTop: 14 }}>
        <div className="card dark-card token-meta-card">
          <h2>{mode === "admin" ? "On-chain Snapshot" : "Token Profile"}</h2>
          {mode === "investor" && (
            <div className="token-meta">
              {tokenImageUrl ? (
                <img src={tokenImageUrl} alt="Token visual" />
              ) : (
                <div className="meta-fallback">No image yet</div>
              )}
              <div>
                <h3>{tokenName || String(getField<any>(stateData, ["tokenName", "token_name"], "-"))}</h3>
                <p className="symbol">{tokenSymbol || String(getField<any>(stateData, ["tokenSymbol", "token_symbol"], "-"))}</p>
                <p>{tokenDescription || String(getField<any>(stateData, ["tokenDescription", "token_description"], "No description yet."))}</p>
              </div>
            </div>
          )}
          <div className="kv">
            <span>State loaded: {stateData ? "yes" : "no"}</span>
            <span>Active: {String(presaleActive)}</span>
            <span>Paused: {String(presalePaused)}</span>
            <span>Total raised: {String(getField<any>(stateData, ["totalRaisedLamports", "total_raised_lamports"], 0))}</span>
            <span>Tokens sold: {String(getField<any>(stateData, ["tokensSold", "tokens_sold"], 0))}</span>
            {mode === "admin" && (
              <span>
                Vault balance: {fromTokenAmount(tokenVaultBalanceRaw, mintDecimals)} tokens ({tokenVaultBalanceRaw.toString()} raw)
              </span>
            )}
            <span>Start: {unixToIso(String(getField<any>(stateData, ["startTime", "start_time"], 0))) || "-"}</span>
            <span>End: {unixToIso(String(getField<any>(stateData, ["endTime", "end_time"], 0))) || "-"}</span>
            {mode === "investor" && (
              <>
                <span>Vested locked: {String(getField<any>(vestingData, ["totalLocked", "total_locked"], 0))}</span>
                <span>Already claimed: {String(getField<any>(vestingData, ["alreadyClaimed", "already_claimed"], 0))}</span>
                <span>User staked: {String(getField<any>(userStakeData, ["amount"], 0))}</span>
                <span>Pool staked: {String(getField<any>(poolData, ["totalStaked", "total_staked"], 0))}</span>
                <span>Pool rewards: {String(getField<any>(poolData, ["remainingRewards", "remaining_rewards"], 0))}</span>
              </>
            )}
          </div>
        </div>
        <div className="card dark-card">
          <h2>Automated Accounts</h2>
          <p className="sub">
            These accounts are derived or created for you automatically, so you never have to supply them manually.
          </p>
          <div className="auto-account-strip" aria-label="Automatically handled accounts">
            <span>state PDA</span><span>token vault</span><span>SOL vault</span><span>vault authority</span>
            <span>vesting account</span><span>staking pool</span><span>stake vault</span><span>reward vault</span><span>associated token accounts</span>
          </div>
        </div>
      </section>

      <details className="reference-panel" style={{ marginTop: 14 }}>
        <summary className="reference-summary">
          <div>
            <span className="section-kicker">Technical reference</span>
            <h2>Smart contract functions &amp; parameters</h2>
            <p>Open for the exact on-chain calls behind each step. Useful when debugging transactions.</p>
          </div>
          <span className="reference-count">{CONTRACT_ACTIONS.filter((a) => a.role === mode || a.role === "shared").length} flows</span>
        </summary>
        <div className="reference-grid">
          {CONTRACT_ACTIONS.filter((a) => a.role === mode || a.role === "shared").map((action) => (
            <article className="reference-item" key={action.name}>
              <h3>{action.name}</h3>
              <p>{action.purpose}</p>
              <div className="param-list">
                {action.params.map((param) => <code key={param}>{param}</code>)}
              </div>
            </article>
          ))}
        </div>
      </details>

      <p className="footer-note">Devnet dashboard. Keep enough SOL for fees and account creation.</p>
    </main>
  );
}
