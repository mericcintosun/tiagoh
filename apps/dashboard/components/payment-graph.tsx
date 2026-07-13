"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/format";
import type { Receipt, ReceiptStatus } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";

/**
 * Payment graph — reconstructs the cascade tree purely from receipts (parentId →
 * callId), exactly as it would rebuild from on-chain ReceiptRegistry events. Cyan
 * `flow` edges are the money path; node color is settlement status.
 */

const NODE_W = 172;
const NODE_H = 58;
const COL_GAP = 96;
const ROW_GAP = 22;
const PAD = 16;

const STATUS_STROKE: Record<ReceiptStatus, string> = {
  settled: "hsl(var(--flow))",
  pending: "hsl(var(--warning))",
  refunded: "hsl(var(--muted-foreground))",
  slashed: "hsl(var(--destructive))",
};

interface Placed {
  r: Receipt;
  x: number;
  y: number;
  depth: number;
}

export function PaymentGraph({
  receipts,
  className,
}: {
  receipts: Receipt[];
  className?: string;
}) {
  const { placed, width, height, edges } = React.useMemo(() => {
    const byCall = new Map<string, Receipt>();
    receipts.forEach((r) => byCall.set(r.callId, r));

    const depthCache = new Map<string, number>();
    const depthOf = (r: Receipt): number => {
      if (depthCache.has(r.id)) return depthCache.get(r.id)!;
      let d = 0;
      if (r.parentId) {
        const parent = byCall.get(r.parentId);
        d = parent ? depthOf(parent) + 1 : 0;
      }
      depthCache.set(r.id, d);
      return d;
    };

    const colCount = new Map<number, number>();
    const placedNodes: Placed[] = receipts.map((r) => {
      const depth = depthOf(r);
      const row = colCount.get(depth) ?? 0;
      colCount.set(depth, row + 1);
      return {
        r,
        depth,
        x: PAD + depth * (NODE_W + COL_GAP),
        y: PAD + row * (NODE_H + ROW_GAP),
      };
    });

    const posById = new Map<string, Placed>();
    placedNodes.forEach((p) => posById.set(p.r.callId, p));

    const edgeList = placedNodes
      .filter((p) => p.r.parentId && posById.has(p.r.parentId))
      .map((p) => {
        const parent = posById.get(p.r.parentId!)!;
        return { from: parent, to: p, amount: p.r.amountUsd };
      });

    const maxDepth = Math.max(0, ...placedNodes.map((p) => p.depth));
    const maxRows = Math.max(1, ...Array.from(colCount.values()));

    return {
      placed: placedNodes,
      edges: edgeList,
      width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP,
      height: PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP,
    };
  }, [receipts]);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-full"
        role="img"
        aria-label="Cascade payment graph reconstructed from receipts"
      >
        {edges.map((e, i) => {
          const x1 = e.from.x + NODE_W;
          const y1 = e.from.y + NODE_H / 2;
          const x2 = e.to.x;
          const y2 = e.to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="hsl(var(--flow))"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                className="animate-flow-dash"
                opacity={0.75}
              />
              <text
                x={mx}
                y={(y1 + y2) / 2 - 6}
                textAnchor="middle"
                className="num fill-muted-foreground"
                fontSize={10}
              >
                {formatUsd(e.amount)}
              </text>
            </g>
          );
        })}

        {placed.map((p) => (
          <g key={p.r.id}>
            <rect
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill="hsl(var(--card))"
              stroke={STATUS_STROKE[p.r.status]}
              strokeWidth={1.25}
            />
            <text
              x={p.x + 12}
              y={p.y + 22}
              className="fill-foreground font-medium"
              fontSize={12}
            >
              {p.r.handle}
            </text>
            <text
              x={p.x + 12}
              y={p.y + 40}
              className="num fill-primary font-semibold"
              fontSize={13}
            >
              {formatUsd(p.r.amountUsd)}
            </text>
            <text
              x={p.x + NODE_W - 12}
              y={p.y + 40}
              textAnchor="end"
              className="num fill-muted-foreground"
              fontSize={10}
            >
              {p.r.callId}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">status</span>
        <Badge variant="flow">settled</Badge>
        <Badge variant="warning">pending</Badge>
        <Badge variant="secondary">refunded</Badge>
        <Badge variant="destructive">slashed</Badge>
      </div>
    </div>
  );
}
