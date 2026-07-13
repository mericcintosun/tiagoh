"use client";

import * as React from "react";
import {
  ArrowBendDownRight,
  CheckCircle,
  Prohibit,
  Clock,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/lib/utils";
import { formatUsd, formatPct } from "@/lib/format";
import type { CascadeNode } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const STATUS: Record<
  CascadeNode["status"],
  { badge: "success" | "warning" | "destructive"; label: string; Icon: React.ComponentType<{ className?: string; weight?: "fill" | "bold" }> }
> = {
  settled: { badge: "success", label: "settled", Icon: CheckCircle },
  pending: { badge: "warning", label: "pending", Icon: Clock },
  rejected: { badge: "destructive", label: "budget exceeded", Icon: Prohibit },
};

function CascadeRow({ node, depth }: { node: CascadeNode; depth: number }) {
  const s = STATUS[node.status];
  const pct = Math.min(100, Math.round((node.amountUsd / node.budgetUsd) * 100));
  const over = node.status === "rejected";

  return (
    <li className="relative">
      <div
        className={cn(
          "card-lift rounded-lg border bg-card p-4",
          over ? "border-destructive/40" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {depth > 0 && (
              <ArrowBendDownRight className="h-4 w-4 text-flow" weight="bold" />
            )}
            <code className="font-mono text-sm font-medium text-foreground">
              {node.label}
            </code>
            <span className="font-mono text-xs text-muted-foreground">
              {node.handle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="num text-sm font-semibold text-primary">
              {formatUsd(node.amountUsd)}
            </span>
            <Badge variant={s.badge} className="gap-1">
              <s.Icon className="h-3 w-3" weight="fill" />
              {s.label}
            </Badge>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Progress
            value={over ? 100 : pct}
            className="h-1.5"
            indicatorClassName={over ? "bg-destructive" : "bg-flow"}
          />
          <span className="num shrink-0 text-xs text-muted-foreground">
            {formatUsd(node.amountUsd)} / {formatUsd(node.budgetUsd)} cap
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          {node.attributionPct > 0 ? (
            <span>
              <span className="num text-flow">{formatPct(node.attributionPct, 0)}</span>{" "}
              attribution flows up
            </span>
          ) : over ? (
            <span className="text-destructive">
              hop refused on-chain, parent budget preserved
            </span>
          ) : (
            <span>root deposit</span>
          )}
        </div>
      </div>

      {node.children && node.children.length > 0 && (
        <ul className="ml-4 mt-3 flex flex-col gap-3 border-l border-dashed border-flow/40 pl-4">
          {node.children.map((child) => (
            <CascadeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function CascadeFlow({
  root,
  className,
}: {
  root: CascadeNode;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      <CascadeRow node={root} depth={0} />
    </ul>
  );
}
