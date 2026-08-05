"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter, SolflareWalletAdapter, TrustWalletAdapter } from "@solana/wallet-adapter-wallets";
import { DEFAULT_RPC } from "@/lib/constants";

type ProviderWithChildren<P = Record<string, unknown>> = React.ComponentType<P & { children?: React.ReactNode }>;

const SafeConnectionProvider = ConnectionProvider as unknown as ProviderWithChildren<{ endpoint: string }>;
const SafeWalletProvider = WalletProvider as unknown as ProviderWithChildren<{ wallets: WalletAdapter[]; autoConnect?: boolean }>;
const SafeWalletModalProvider = WalletModalProvider as unknown as ProviderWithChildren;

export default function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC;
  const wallets = useMemo<WalletAdapter[]>(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new TrustWalletAdapter()], []);

  return (
    <SafeConnectionProvider endpoint={endpoint}>
      <SafeWalletProvider wallets={wallets} autoConnect={false}>
        <SafeWalletModalProvider>{children}</SafeWalletModalProvider>
      </SafeWalletProvider>
    </SafeConnectionProvider>
  );
}
