"use client";

import { Gavel, TrendDown } from "@phosphor-icons/react/dist/ssr";

import { AppShell, PageHeading } from "@/components/app-shell";
import { AuctionBoard } from "@/components/auction-board";
import { StatTiles } from "@/components/stat-tiles";
import { Card, CardContent } from "@/components/ui/card";
import { useAuctions } from "@/lib/chain-data";
import type { StatTile } from "@/lib/mock";

const auctionStats: StatTile[] = [
  { label: "open auctions", value: "1", sub: "accepting bids", accent: "warning" },
  { label: "cleared 24h", value: "42", sub: "settled on-chain", accent: "success" },
  { label: "avg. savings", value: "38%", sub: "vs. sticker price", accent: "primary" },
  { label: "eligible bidders", value: "bonded", sub: "reputation-filtered", accent: "flow" },
];

export default function AuctionPage() {
  const auctions = useAuctions();
  const open = auctions.data.filter((a) => a.status === "open");
  const cleared = auctions.data.filter((a) => a.status === "cleared");

  return (
    <AppShell>
      <PageHeading
        eyebrow="Live tool auction"
        title="Reverse auctions for tool calls"
        description="Post a capability request; bonded, reputation-ranked tools compete on price and quality. Best value wins and settles through the cascade rails."
        source={auctions.source}
      />

      <StatTiles tiles={auctionStats} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Gavel className="h-4 w-4 text-warning" weight="fill" />
            <h2 className="text-base font-semibold">Open now</h2>
          </div>
          {open.length > 0 ? (
            open.map((a) => <AuctionBoard key={a.id} auction={a} />)
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No open auctions.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendDown className="h-4 w-4 text-success" weight="fill" />
            <h2 className="text-base font-semibold">Recently cleared</h2>
          </div>
          {cleared.map((a) => (
            <AuctionBoard key={a.id} auction={a} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
