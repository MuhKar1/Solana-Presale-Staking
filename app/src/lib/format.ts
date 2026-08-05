export function shortPk(pk: string | undefined | null): string {
  if (!pk) return "-";
  return `${pk.slice(0, 4)}...${pk.slice(-4)}`;
}

export function toLamports(sol: string): bigint {
  const n = Number(sol);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.floor(n * 1_000_000_000));
}

export function toTokenAmount(amount: string, decimals: number): bigint {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.floor(n * Math.pow(10, decimals)));
}

export function fromTokenAmount(raw: bigint | number, decimals: number): string {
  const big = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = big / base;
  const frac = big % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

export function unixToIso(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoToUnix(iso: string): bigint {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 0n;
  return BigInt(Math.floor(ms / 1000));
}
