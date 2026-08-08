"use client";

import { ChartBar, Coins, GitBranch, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { AppShell, PageHeading } from "@/components/app-shell";
import { StatTiles } from "@/components/stat-tiles";
import { Badge } from "@/components/ui/badge";
import { useTxMetrics, EXCLUDED_WALLETS, explorerAddressUrl } from "@/lib/metrics-data";
import { deployedContracts } from "@/lib/deployments";
import type { StatTile } from "@/lib/mock";

const fmt = (n: number | null | undefined, digits = 0, suffix = ""): string =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`;

export default function MetricsPage() {
  const { data, isLoading } = useTxMetrics();

  const tiles: StatTile[] = [
    {
      label: "share of GOAT txs today",
      value: data?.shareOfChainTodayPct != null ? `${data.shareOfChainTodayPct}%` : "—",
      sub: `${fmt(data?.settlementsToday)} of ${fmt(data?.chainTxsToday)} chain txs`,
      accent: "primary",
    },
    {
      label: "gas contributed",
      value: data?.gasSats != null ? `${fmt(data.gasSats, 1)} sats` : "—",
      sub: "real fees paid to GOAT",
      accent: "flow",
    },
    {
      label: "unique paying agents",
      value: fmt(data?.uniquePayers),
      sub: "distinct payer addresses",
      accent: "success",
    },
    {
      label: "median value / settlement",
      value: data?.medianValueUsd != null ? `$${data.medianValueUsd.toFixed(3)}` : "—",
      sub: `$${fmt(data?.totalValueUsd, 2)} settled total`,
      accent: "warning",
    },
  ];

  return (
    <AppShell>
      <PageHeading
        eyebrow="Metrics"
        title="The counter, in public"
        description="Every number on this page is computed client-side from GOAT's public RPC and explorer — nothing is self-reported. Small numbers are fine; the point is that you can watch them move and reproduce them yourself."
        source={data?.source ?? "stub"}
      />

      <StatTiles tiles={tiles} />

      {/* Cascade depth — the multiplier, proven */}
      <div className="mt-10 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-flow" />
        <h2 className="text-base font-semibold">Cascade depth distribution</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        One agent task fans out into separately settled sub-calls. Depth 0 is a root call; depth 1+ are
        downstream hops linked on-chain via their parent receipt. This is what makes tiagoh a transaction
        multiplier rather than a transaction claim.
      </p>
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-2.5">cascade depth</th>
              <th className="px-4 py-2.5 text-right">settlements</th>
            </tr>
          </thead>
          <tbody>
            {(data?.cascadeDepths?.length ? data.cascadeDepths : [{ depth: 0, count: 0 }]).map((d) => (
              <tr key={d.depth} className="border-t border-border">
                <td className="px-4 py-2.5">
                  {d.depth === 0 ? "root call" : `hop ${d.depth}`}
                </td>
                <td className="num px-4 py-2.5 text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Excluded traffic — self-reported honesty */}
      <div className="mt-10 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-success" />
        <h2 className="text-base font-semibold">Traffic we exclude ourselves</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        The headline counts above only include the USDC.e-settled suite. Everything below is our own
        historical or internal activity, published so the exclusion is auditable rather than claimed.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            legacy suites (DemoToken era)
          </span>
          <ul className="mt-2 space-y-1.5 text-sm">
            {(data?.legacyReceipts ?? []).map((l) => (
              <li key={l.label} className="flex items-center justify-between">
                <span>{l.label}</span>
                <span className="num text-muted-foreground">{l.count} receipts · excluded</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border p-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            team wallets (excluded from “external” counts)
          </span>
          <ul className="mt-2 space-y-1.5 text-sm">
            {EXCLUDED_WALLETS.map((w) => (
              <li key={w.address} className="flex items-center justify-between gap-2">
                <a
                  className="truncate font-mono text-xs text-flow underline-offset-2 hover:underline"
                  href={explorerAddressUrl(w.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {w.address}
                </a>
                <span className="shrink-0 text-muted-foreground">{w.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Methodology */}
      <div className="mt-10 flex items-center gap-2">
        <ChartBar className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">Methodology</h2>
      </div>
      <div className="mt-3 space-y-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <p>
          <Badge variant="flow" className="mr-2">1</Badge>
          <strong className="text-foreground">Share of chain:</strong> ReceiptRecorded events on the USDC.e
          ReceiptRegistry (<span className="font-mono text-xs">{deployedContracts.receiptRegistry}</span>) counted
          for the current UTC day, divided by the explorer&rsquo;s <span className="font-mono text-xs">transactions_today</span>.
        </p>
        <p>
          <Badge variant="flow" className="mr-2">2</Badge>
          <strong className="text-foreground">Gas contributed:</strong> sum of <span className="font-mono text-xs">gasUsed × effectiveGasPrice</span> over
          our settlement transactions (first 100), read from transaction receipts — real fees paid, not estimates.
        </p>
        <p>
          <Badge variant="flow" className="mr-2">3</Badge>
          <strong className="text-foreground">Anti-wash stance:</strong> buyer and seller run on separate wallets, the
          seller payout is never funded by the buyer, reputation writes are bundled into settlement rather than
          emitted as separate near-zero-value transactions, and team wallets are listed above. A cascade can
          resemble wash trading to a naive graph heuristic — the answer is to publish the filter, so we do.
        </p>
        <p>
          <Badge variant="flow" className="mr-2">4</Badge>
          <strong className="text-foreground">Retention:</strong> month-over-month wallet retention will appear here
          once there are two full months of history — publishing it early would be noise, not honesty.
        </p>
        <p className="pt-1 text-xs">
          Every settlement is ERC-8021 builder-code tagged (calldata suffix{" "}
          <span className="font-mono">0x80218021…00·tiagoh</span>), so this entire dataset is independently
          filterable on-chain without trusting this page. Fetched {data?.fetchedAt ?? "…"}
          {isLoading ? " · refreshing" : ""} · auto-refreshes every 30s.
        </p>
      </div>
    </AppShell>
  );
}
