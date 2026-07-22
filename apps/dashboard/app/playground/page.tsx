"use client";

import * as React from "react";
import {
  CheckCircle,
  Prohibit,
  Wallet,
  ArrowUUpLeft,
  TreeStructure,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatUsd, formatPct } from "@/lib/format";
import { AppShell, PageHeading } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useCascade } from "@/lib/chain-data";
import type { CascadeNode } from "@/lib/mock";

interface Hop {
  id: string;
  label: string;
  handle: string;
  amount: number;
  attribution: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Flatten a real cascade tree into the downstream hops the root paid for. */
function toHops(root: CascadeNode): Hop[] {
  const out: Hop[] = [];
  const walk = (n: CascadeNode) => {
    for (const c of n.children ?? []) {
      out.push({
        id: c.id,
        label: c.label,
        handle: c.handle,
        amount: round2(c.amountUsd) || 0.01,
        attribution: c.attributionPct,
      });
      walk(c);
    }
  };
  walk(root);
  return out;
}

export default function PlaygroundPage() {
  const { data: tree, source } = useCascade();

  const [hops, setHops] = React.useState<Hop[]>([]);
  const [budget, setBudget] = React.useState(1);
  const seededId = React.useRef<string | null>(null);

  // Seed the editable what-if from the live cascade once (re-seed only if a new cascade appears).
  React.useEffect(() => {
    if (!tree || seededId.current === tree.id) return;
    seededId.current = tree.id;
    const seeded = toHops(tree);
    setHops(seeded);
    const total = seeded.reduce((s, h) => s + h.amount, 0);
    setBudget(round2(Math.max(0.5, total * 1.2)));
  }, [tree]);

  // Budget-slider bounds scale to the real hop costs, so the on-chain rejection stays reachable.
  const totalCost = React.useMemo(() => hops.reduce((s, h) => s + h.amount, 0), [hops]);
  const budgetMax = Math.max(round2(totalCost * 1.5), 1);
  const budgetStep = Math.max(0.01, round2(budgetMax / 100));

  // Sequential budget check, mirrors CascadeController: a hop that would exceed the
  // remaining root budget is refused on-chain (BudgetExceeded), preserving parents.
  const evaluated = React.useMemo(() => {
    let spent = 0;
    let attributedUp = 0;
    const rows = hops.map((h) => {
      const wouldSpend = spent + h.amount;
      const settled = wouldSpend <= budget;
      if (settled) {
        spent = wouldSpend;
        attributedUp += (h.amount * h.attribution) / 100;
      }
      return { ...h, settled };
    });
    return { rows, spent, refund: Math.max(0, budget - spent), attributedUp };
  }, [hops, budget]);

  const settledCount = evaluated.rows.filter((r) => r.settled).length;
  const rejectedCount = evaluated.rows.length - settledCount;

  function updateHop(id: string, patch: Partial<Hop>) {
    setHops((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }

  function settle() {
    toast.success("Cascade evaluated", {
      description: `${settledCount} hops settle · ${formatUsd(evaluated.spent)} spent · ${formatUsd(evaluated.refund)} refunded to root.`,
    });
  }

  const liveNote =
    source === "chain"
      ? "Seeded from a real cascade anchored on GOAT mainnet. Tune the budget to model the on-chain rejection over live hop costs."
      : "No cascade on chain to read yet, so this shows an illustrative cascade. It goes live as soon as receipts are anchored.";

  return (
    <AppShell>
      <PageHeading
        eyebrow="Playground"
        title="Interactive cascade"
        description="Open a root budget, tune each hop, and watch the contract refuse any hop that would blow the cap, then refund the remainder on close."
        source={source}
        action={
          <Button onClick={settle} size="sm">
            <Sparkle className="h-4 w-4" weight="fill" />
            Evaluate cascade
          </Button>
        }
      />

      <p className="mb-6 text-sm text-muted-foreground">{liveNote}</p>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        {/* ── Controls / hops ─────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-primary" weight="fill" />
                Root budget
              </CardTitle>
              <span className="num text-lg font-semibold text-primary">
                {formatUsd(budget)}
              </span>
            </CardHeader>
            <CardContent>
              <Slider
                value={[budget]}
                min={0}
                max={budgetMax}
                step={budgetStep}
                onValueChange={(v) => setBudget(v[0] ?? budget)}
              />
              <div className="mt-3 flex items-center gap-3">
                <Progress
                  value={budget > 0 ? (evaluated.spent / budget) * 100 : 0}
                  className="h-2"
                  indicatorClassName="bg-flow"
                />
                <span className="num shrink-0 text-xs text-muted-foreground">
                  {formatUsd(evaluated.spent)} / {formatUsd(budget)}
                </span>
              </div>
            </CardContent>
          </Card>

          {evaluated.rows.map((h, i) => (
            <Card
              key={h.id}
              className={cn("card-lift", !h.settled && "border-destructive/40")}
            >
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="num text-xs text-muted-foreground">
                      hop {i + 1}
                    </span>
                    <code className="font-mono text-sm font-medium">{h.label}</code>
                    <span className="font-mono text-xs text-muted-foreground">
                      {h.handle}
                    </span>
                  </div>
                  {h.settled ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle className="h-3 w-3" weight="fill" />
                      settled
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <Prohibit className="h-3 w-3" weight="fill" />
                      budget exceeded
                    </Badge>
                  )}
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">price</span>
                      <span className="num font-medium text-primary">
                        {formatUsd(h.amount)}
                      </span>
                    </div>
                    <Slider
                      value={[h.amount]}
                      min={0.01}
                      max={Math.max(1, round2(h.amount * 3))}
                      step={0.01}
                      onValueChange={(v) => updateHop(h.id, { amount: v[0] ?? h.amount })}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">attribution up</span>
                      <span className="num font-medium text-flow">
                        {formatPct(h.attribution, 0)}
                      </span>
                    </div>
                    <Slider
                      value={[h.attribution]}
                      min={0}
                      max={40}
                      step={1}
                      onValueChange={(v) =>
                        updateHop(h.id, { attribution: v[0] ?? h.attribution })
                      }
                    />
                  </div>
                </div>

                {!h.settled && (
                  <p className="mt-3 text-xs text-destructive">
                    Refused on-chain: this hop would exceed the remaining root budget.
                    Parents are preserved.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Summary ─────────────────────────────────────── */}
        <Card className="lg:sticky lg:top-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TreeStructure className="h-4 w-4 text-flow" weight="fill" />
              Cascade summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row label="Root budget" value={formatUsd(budget)} tone="text-primary" />
            <Row label="Spent" value={formatUsd(evaluated.spent)} tone="text-foreground" />
            <Row
              label="Attributed up"
              value={formatUsd(evaluated.attributedUp)}
              tone="text-flow"
            />
            <Separator />
            <Row
              label="Refund on close"
              value={formatUsd(evaluated.refund)}
              tone="text-success"
              icon={<ArrowUUpLeft className="h-4 w-4 text-success" weight="bold" />}
            />
            <div className="flex items-center gap-2 pt-1">
              <Badge variant="success">{settledCount} settled</Badge>
              {rejectedCount > 0 && (
                <Badge variant="destructive">{rejectedCount} rejected</Badge>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Every settlement anchors a receipt with its cascade parentId; the hops above
              are reconstructed from those links. Drag the budget below the hop costs to see
              the on-chain rejection.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Row({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={cn("num text-base font-semibold", tone)}>{value}</span>
    </div>
  );
}
