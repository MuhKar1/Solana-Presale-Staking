import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import React from "react";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Presale Dashboard",
  description: "Devnet control panel for the presale and staking program.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
