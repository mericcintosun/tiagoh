"use client";

import {
  TrendUp,
  TrendDown,
  Minus,
  SealCheck,
  Star,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/lib/utils";
import { formatNumber, formatPct, formatUsdCompact } from "@/lib/format";
import type { ReputationEntry } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

const TREND = {
  up: { Icon: TrendUp, className: "text-success" },
  down: { Icon: TrendDown, className: "text-destructive" },
  flat: { Icon: Minus, className: "text-muted-foreground" },
} as const;

function scoreTone(score: number) {
  if (score >= 900) return "text-primary";
  if (score >= 800) return "text-flow";
  if (score >= 650) return "text-warning";
  return "text-destructive";
}

export function ReputationLeaderboard({
  entries,
  className,
}: {
  entries: ReputationEntry[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Success</TableHead>
            <TableHead className="text-right">Volume</TableHead>
            <TableHead className="text-right">Bond</TableHead>
            <TableHead className="text-right">Payers</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => {
            const trend = TREND[e.trend];
            return (
              <TableRow key={e.handle}>
                <TableCell className="num text-muted-foreground">
                  {e.rank}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {e.rank === 1 && (
                      <SealCheck className="h-4 w-4 text-primary" weight="fill" />
                    )}
                    <span className="font-mono text-sm font-medium">{e.handle}</span>
                    {e.slashes === 0 && (
                      <Badge variant="success" className="hidden sm:inline-flex">
                        no slashes
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <HoverCard openDelay={100}>
                    <HoverCardTrigger asChild>
                      <button
                        className={cn(
                          "num inline-flex items-center gap-1 font-semibold",
                          scoreTone(e.score),
                        )}
                      >
                        <Star className="h-3.5 w-3.5" weight="fill" />
                        {e.score}
                        <trend.Icon className={cn("h-3.5 w-3.5", trend.className)} weight="bold" />
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-72">
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        score = f(receipts)
                      </p>
                      <div className="mt-3 space-y-2 text-xs">
                        <Metric label="Success rate" value={formatPct(e.successRate)} />
                        <Metric label="Settled volume" value={formatNumber(e.volume)} />
                        <Metric label="Unique payers" value={formatNumber(e.uniquePayers)} />
                        <Metric label="Disputes" value={formatNumber(e.disputes)} tone={e.disputes > 15 ? "warn" : undefined} />
                        <Metric label="Slashes" value={formatNumber(e.slashes)} tone={e.slashes > 0 ? "bad" : "good"} />
                      </div>
                      <div className="mt-3">
                        <Progress value={(e.score / 1000) * 100} className="h-1.5" />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Aggregated on-chain via ERC-8004 signals + tiagoh receipts.
                      </p>
                    </HoverCardContent>
                  </HoverCard>
                </TableCell>
                <TableCell className="num text-right">{formatPct(e.successRate)}</TableCell>
                <TableCell className="num text-right">{formatNumber(e.volume)}</TableCell>
                <TableCell className="num text-right text-primary">
                  {formatUsdCompact(e.bondUsd)}
                </TableCell>
                <TableCell className="num text-right">{formatNumber(e.uniquePayers)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("num font-medium", toneClass)}>{value}</span>
    </div>
  );
}
