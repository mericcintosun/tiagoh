"use client";

import { TrendUp, Receipt, TreeStructure } from "@phosphor-icons/react/dist/ssr";

import { AppShell, PageHeading } from "@/components/app-shell";
import { StatTiles } from "@/components/stat-tiles";
import { RevenueChart } from "@/components/revenue-chart";
import { ReceiptsTable } from "@/components/receipts-table";
import { PaymentGraph } from "@/components/payment-graph";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dashboardStats } from "@/lib/mock";
import { useReceipts, useRevenue, useReceiptRegistryStats } from "@/lib/chain-data";

export default function DashboardPage() {
  const revenue = useRevenue();
  const receipts = useReceipts();
  const stats = useReceiptRegistryStats();

  return (
    <AppShell>
      <PageHeading
        eyebrow="Seller dashboard"
        title="Revenue, receipts & the cascade graph"
        description="Live earnings from paid MCP tool calls — settled on GOAT with Bitcoin finality, read client-side straight from chain."
        source={revenue.source}
      />

      <StatTiles tiles={dashboardStats} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendUp className="h-4 w-4 text-primary" weight="fill" />
              Revenue over time
            </CardTitle>
            <span className="num text-xs text-muted-foreground">last 30 days</span>
          </CardHeader>
          <CardContent>
            <RevenueChart data={revenue.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TreeStructure className="h-4 w-4 text-flow" weight="fill" />
              Cascade payment graph
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentGraph receipts={receipts.data} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" weight="fill" />
          <h2 className="text-base font-semibold">On-chain receipts</h2>
          <span className="ml-auto flex items-center gap-1.5 rounded-md border border-flow/30 bg-flow/10 px-2 py-0.5 num text-xs text-flow">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-flow" />
            live · ReceiptRegistry.count={stats.count?.toString() ?? "…"} · vol={stats.totalVolumeRaw?.toString() ?? "…"}
          </span>
        </div>
        <ReceiptsTable receipts={receipts.data} />
      </div>
    </AppShell>
  );
}
