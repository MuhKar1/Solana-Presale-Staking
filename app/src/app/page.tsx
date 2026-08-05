import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-shell">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">Demo UI</p>
          <h1 id="landing-title">Token presale management for participants and administrators</h1>
          <p>
            This is a demo UI for a Solana-based token presale application. It shows how participants can buy tokens,
            claim vested tokens, request refunds when a sale does not meet its soft cap, and manage staking rewards. It
            also shows how administrators can create the token, configure sale rules, fund vaults, pause activity,
            finalize the presale, and manage reward distribution.
          </p>
        </div>

        <div className="role-options" aria-label="Choose how to continue">
          <Link className="role-option primary" href="/investor">
            <span>Continue as user</span>
            <small>Buy tokens, claim tokens, request refunds, stake, and claim rewards.</small>
          </Link>
          <Link className="role-option" href="/admin">
            <span>Continue as admin</span>
            <small>Create and configure the presale, fund vaults, pause actions, and finalize the sale.</small>
          </Link>
        </div>
      </section>
    </main>
  );
}
