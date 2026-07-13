"use client";

import {
  ShieldCheck,
  ShieldWarning,
  ArrowSquareOut,
  ArrowDownRight,
  ArrowUpRight,
  ArrowUUpLeft,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/lib/utils";
import { formatUsd, formatUsdCompact, explorerTx, shortHash, timeAgo } from "@/lib/format";
import type { BondEvent, ReputationEntry } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A single tool's staked-bond health meter (fill vs. tier ceiling). */
export function BondMeter({
  entry,
  ceilingUsd = 5000,
  className,
}: {
  entry: Pick<ReputationEntry, "handle" | "bondUsd" | "slashes">;
  ceilingUsd?: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.round((entry.bondUsd / ceilingUsd) * 100));
  const healthy = entry.slashes === 0;

  return (
    <Card className={cn("card-lift", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {healthy ? (
              <ShieldCheck className="h-4 w-4 text-success" weight="fill" />
            ) : (
              <ShieldWarning className="h-4 w-4 text-warning" weight="fill" />
            )}
            <span className="font-mono text-sm font-medium">{entry.handle}</span>
          </div>
          <span className="num text-sm font-semibold text-primary">
            {formatUsd(entry.bondUsd)}
          </span>
        </div>
        <Progress
          value={pct}
          className="mt-3 h-1.5"
          indicatorClassName={healthy ? "bg-success" : "bg-warning"}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="num">
            {pct}% of {formatUsdCompact(ceilingUsd)} tier
          </span>
          {entry.slashes > 0 ? (
            <span className="num text-destructive">{entry.slashes} slashed</span>
          ) : (
            <Badge variant="success">insured</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const KIND = {
  staked: { Icon: ArrowUpRight, tone: "text-flow", label: "staked" },
  slashed: { Icon: ArrowDownRight, tone: "text-destructive", label: "slashed" },
  refund: { Icon: ArrowUUpLeft, tone: "text-success", label: "refund" },
  topup: { Icon: ArrowUpRight, tone: "text-primary", label: "top-up" },
} as const;

/** Live bond / slash / refund feed. */
export function BondFeed({
  events,
  className,
}: {
  events: BondEvent[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Bond &amp; slash feed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 p-2">
        {events.map((e) => {
          const k = KIND[e.kind];
          return (
            <div
              key={e.id}
              className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50"
            >
              <k.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", k.tone)} weight="bold" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{e.handle}</span>
                  <span className={cn("num text-sm font-semibold", k.tone)}>
                    {e.kind === "slashed" ? "−" : "+"}
                    {formatUsd(e.amountUsd)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant={
                      e.kind === "slashed"
                        ? "destructive"
                        : e.kind === "refund"
                          ? "success"
                          : "flow"
                    }
                  >
                    {k.label}
                  </Badge>
                  {e.reason && <span className="truncate">{e.reason}</span>}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={explorerTx(e.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="num inline-flex items-center gap-1 text-xs text-flow hover:underline"
                  >
                    {shortHash(e.txHash)}
                    <ArrowSquareOut className="h-3 w-3" />
                  </a>
                  <span className="num text-xs text-muted-foreground">{timeAgo(e.ts)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
