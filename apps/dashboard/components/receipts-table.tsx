"use client";

import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/lib/utils";
import { formatUsd, shortHash, explorerTx, timeAgo } from "@/lib/format";
import type { Receipt, ReceiptStatus } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/copy-button";
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

const STATUS: Record<ReceiptStatus, { variant: "flow" | "warning" | "secondary" | "destructive"; label: string }> = {
  settled: { variant: "flow", label: "settled" },
  pending: { variant: "warning", label: "pending" },
  refunded: { variant: "secondary", label: "refunded" },
  slashed: { variant: "destructive", label: "slashed" },
};

export function ReceiptsTable({
  receipts,
  className,
}: {
  receipts: Receipt[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>Payer</TableHead>
            <TableHead>Cascade</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Settlement</TableHead>
            <TableHead className="text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((r) => {
            const s = STATUS[r.status];
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <span className="font-mono text-sm font-medium">{r.handle}</span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.payer}
                  </span>
                </TableCell>
                <TableCell>
                  {r.parentId ? (
                    <span className="num text-xs text-flow">↳ {r.parentId}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">root</span>
                  )}
                </TableCell>
                <TableCell className="num text-right font-semibold text-primary">
                  {formatUsd(r.amountUsd)}
                </TableCell>
                <TableCell>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <HoverCard openDelay={100}>
                      <HoverCardTrigger asChild>
                        <a
                          href={explorerTx(r.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="num inline-flex items-center gap-1 text-xs text-flow hover:underline"
                        >
                          {shortHash(r.txHash)}
                          <ArrowSquareOut className="h-3 w-3" />
                        </a>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-auto max-w-sm">
                        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          settlement tx
                        </p>
                        <p className="num mt-1 break-all text-xs text-foreground">
                          {r.txHash}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Anchored on GOAT with Bitcoin finality.
                        </p>
                      </HoverCardContent>
                    </HoverCard>
                    <CopyButton value={r.txHash} label="tx hash" />
                  </div>
                </TableCell>
                <TableCell className="num text-right text-xs text-muted-foreground">
                  {timeAgo(r.ts)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
