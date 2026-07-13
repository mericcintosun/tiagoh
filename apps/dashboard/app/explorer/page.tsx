"use client";

import { Star, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { AppShell, PageHeading } from "@/components/app-shell";
import { StatTiles } from "@/components/stat-tiles";
import { ReputationLeaderboard } from "@/components/reputation-leaderboard";
import { BondMeter, BondFeed } from "@/components/bond-meter";
import { useLeaderboard, useBondFeed } from "@/lib/chain-data";
import type { StatTile } from "@/lib/mock";

const explorerStats: StatTile[] = [
  { label: "ranked tools", value: "6", sub: "by receipts", accent: "primary" },
  { label: "total bonded", value: "$15,000", sub: "staked insurance", accent: "flow" },
  { label: "unique payers", value: "727", sub: "demand side", accent: "success" },
  { label: "slashes 30d", value: "10", sub: "bad output caught", accent: "warning" },
];

export default function ExplorerPage() {
  const leaderboard = useLeaderboard();
  const bonds = useBondFeed();

  return (
    <AppShell>
      <PageHeading
        eyebrow="Explorer"
        title="Reputation leaderboard & bond feed"
        description="Tools ranked by proven usage and outcome quality. Every score traces to the on-chain receipts and slashes that produced it."
        source={leaderboard.source}
      />

      <StatTiles tiles={explorerStats} />

      <div className="mt-6 flex items-center gap-2">
        <Star className="h-4 w-4 text-primary" weight="fill" />
        <h2 className="text-base font-semibold">Reputation leaderboard</h2>
      </div>
      <div className="mt-3">
        <ReputationLeaderboard entries={leaderboard.data} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" weight="fill" />
            <h2 className="text-base font-semibold">Bond health</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {leaderboard.data.map((e) => (
              <BondMeter key={e.handle} entry={e} />
            ))}
          </div>
        </div>
        <BondFeed events={bonds.data} />
      </div>
    </AppShell>
  );
}
