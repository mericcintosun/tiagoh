/**
 * Formatting helpers. All numbers in tiagoh render mono + tabular; these keep the
 * grouping/precision consistent so the ledger reads cleanly.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const num = new Intl.NumberFormat("en-US");

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function formatUsdCompact(value: number): string {
  return usdCompact.format(value);
}

export function formatNumber(value: number): string {
  return num.format(value);
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** Shorten a 0x hash/address to `0x1234…abcd`. */
export function shortHash(hash: string, lead = 6, tail = 4): string {
  if (!hash) return "";
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/** Explorer tx link from the public GOAT explorer base. */
export function explorerTx(hash: string): string {
  const base =
    process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? "https://explorer.goat.network";
  return `${base.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  const base =
    process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? "https://explorer.goat.network";
  return `${base.replace(/\/$/, "")}/address/${address}`;
}

/** Relative "3m ago" style time from a ms timestamp. */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
