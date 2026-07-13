"use client";

import * as React from "react";
import {
  Scales,
  ArrowSquareOut,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
} from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatUsd, explorerTx, shortHash, timeAgo } from "@/lib/format";
import type { Dispute } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

const STATUS: Record<
  Dispute["status"],
  { variant: "warning" | "success" | "destructive" | "secondary"; label: string; Icon: React.ComponentType<{ className?: string; weight?: "fill" }> }
> = {
  open: { variant: "warning", label: "open", Icon: Clock },
  arbitrating: { variant: "warning", label: "arbitrating", Icon: Scales },
  refunded: { variant: "success", label: "refunded", Icon: CheckCircle },
  rejected: { variant: "destructive", label: "rejected", Icon: XCircle },
};

export function DisputeCard({
  dispute,
  className,
}: {
  dispute: Dispute;
  className?: string;
}) {
  const s = STATUS[dispute.status];
  const resolved = dispute.status === "refunded" || dispute.status === "rejected";

  return (
    <Card className={cn("card-lift", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Scales className="h-4 w-4 text-primary" weight="fill" />
            <span className="font-mono text-sm font-medium">{dispute.handle}</span>
          </div>
          <Badge variant={s.variant} className="gap-1">
            <s.Icon className="h-3 w-3" weight="fill" />
            {s.label}
          </Badge>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">{dispute.reason}</p>

        {/* atomic unwind mini-diagram — refund flows back UP the cascade hops */}
        <div className="mt-4 flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 p-3">
          {Array.from({ length: dispute.hops }).map((_, i) => (
            <React.Fragment key={i}>
              <span
                className={cn(
                  "num flex h-6 min-w-[2rem] items-center justify-center rounded px-1.5 text-xs font-medium",
                  i === dispute.hops - 1
                    ? "bg-destructive/15 text-destructive"
                    : "bg-success/15 text-success",
                )}
              >
                h{i + 1}
              </span>
              {i < dispute.hops - 1 && (
                <ArrowLeft className="h-3.5 w-3.5 text-success" weight="bold" />
              )}
            </React.Fragment>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">
            atomic unwind · splits reversed
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Field label="Claim" value={formatUsd(dispute.claimUsd)} tone="text-primary" />
          <Field label="Bond at risk" value={formatUsd(dispute.bondUsd)} tone="text-foreground" />
          <Field label="Arbiter" value={dispute.arbiter} tone="text-flow" mono />
        </div>

        <Separator className="my-4" />

        <div className="flex items-center justify-between">
          <a
            href={explorerTx(dispute.txHash)}
            target="_blank"
            rel="noreferrer"
            className="num inline-flex items-center gap-1 text-xs text-flow hover:underline"
          >
            {shortHash(dispute.txHash)}
            <ArrowSquareOut className="h-3 w-3" />
          </a>
          <span className="num text-xs text-muted-foreground">
            {timeAgo(dispute.openedTs)}
          </span>
        </div>

        {!resolved && (
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="mt-4 w-full">
                Rule &amp; trigger atomic refund
              </Button>
            </DialogTrigger>
            <RuleDialog dispute={dispute} />
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", mono ? "num text-xs" : "num", tone)}>
        {value}
      </span>
    </div>
  );
}

function RuleDialog({ dispute }: { dispute: Dispute }) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rule on dispute {dispute.id}</DialogTitle>
        <DialogDescription>
          A ruling for the buyer slashes {formatUsd(dispute.bondUsd)} of bond, refunds{" "}
          {formatUsd(dispute.claimUsd)}, and unwinds {dispute.hops} cascade hops
          atomically with revenue splits reversed. Outcome feeds ERC-8004 reputation.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="mt-2">
        <DialogClose asChild>
          <Button
            variant="destructive"
            onClick={() =>
              toast.error("Ruled against tool", {
                description: `${formatUsd(dispute.bondUsd)} slashed · ${formatUsd(dispute.claimUsd)} refunded atomically.`,
              })
            }
          >
            Rule for buyer (refund)
          </Button>
        </DialogClose>
        <DialogClose asChild>
          <Button
            variant="ghost"
            onClick={() =>
              toast("Dispute dismissed", {
                description: "Bond preserved; no refund issued.",
              })
            }
          >
            Dismiss
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
