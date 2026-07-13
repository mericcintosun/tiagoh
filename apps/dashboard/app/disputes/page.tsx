"use client";

import { Scales, CheckCircle, Clock } from "@phosphor-icons/react/dist/ssr";

import { AppShell, PageHeading } from "@/components/app-shell";
import { DisputeCard } from "@/components/dispute-card";
import { StatTiles } from "@/components/stat-tiles";
import { useDisputes } from "@/lib/chain-data";
import type { StatTile } from "@/lib/mock";

const disputeStats: StatTile[] = [
  { label: "open disputes", value: "1", sub: "awaiting ruling", accent: "warning" },
  { label: "arbitrating", value: "1", sub: "verifier swarm", accent: "flow" },
  { label: "refunded 30d", value: "$1,240", sub: "atomic unwinds", accent: "success" },
  { label: "bond slashed", value: "$2,500", sub: "bad output", accent: "destructive" },
];

export default function DisputesPage() {
  const disputes = useDisputes();
  const active = disputes.data.filter(
    (d) => d.status === "open" || d.status === "arbitrating",
  );
  const resolved = disputes.data.filter(
    (d) => d.status === "refunded" || d.status === "rejected",
  );

  return (
    <AppShell>
      <PageHeading
        eyebrow="Dispute center"
        title="Arbitration & atomic refunds"
        description="When a hop underdelivers, a dispute rolls the cascade back atomically — bond slashed, buyer refunded, splits reversed, reputation updated. BitVM2 is the trust-minimized upgrade path."
        source={disputes.source}
      />

      <StatTiles tiles={disputeStats} />

      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-warning" weight="fill" />
          <h2 className="text-base font-semibold">Active</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((d) => (
            <DisputeCard key={d.id} dispute={d} />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-success" weight="fill" />
          <h2 className="text-base font-semibold">Resolved</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {resolved.map((d) => (
            <DisputeCard key={d.id} dispute={d} />
          ))}
        </div>
        {resolved.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <Scales className="mr-1 inline h-4 w-4" /> No resolved disputes yet.
          </p>
        )}
      </div>
    </AppShell>
  );
}
