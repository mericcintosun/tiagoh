"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Gavel,
  Trophy,
  Prohibit,
  Lightning,
  ShieldCheck,
  Star,
} from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import type { Auction, AuctionBid } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Slider } from "@/components/ui/slider";

const AUCTION_WINDOW_MS = 30_000;

function rank(bid: AuctionBid, policy: Auction["policy"]): number {
  if (bid.status === "ineligible") return Number.POSITIVE_INFINITY;
  // reputation-weighted value: lower is better; discount price by reputation.
  return policy === "lowest-price"
    ? bid.priceUsd
    : bid.priceUsd / (0.5 + bid.reputation / 1000);
}

export function AuctionBoard({
  auction,
  className,
}: {
  auction: Auction;
  className?: string;
}) {
  const [remaining, setRemaining] = React.useState(auction.closesInMs);

  React.useEffect(() => {
    if (auction.status === "cleared") return;
    const id = setInterval(() => {
      setRemaining((r) => (r <= 250 ? 0 : r - 250));
    }, 250);
    return () => clearInterval(id);
  }, [auction.status]);

  const open = auction.status === "open" && remaining > 0;

  const ordered = React.useMemo(() => {
    return [...auction.bids].sort(
      (a, b) => rank(a, auction.policy) - rank(b, auction.policy),
    );
  }, [auction.bids, auction.policy]);

  const winnerHandle =
    auction.winner ??
    ordered.find((b) => b.status !== "ineligible")?.handle ??
    null;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-primary" weight="fill" />
              <code className="font-mono text-sm font-medium">{auction.capability}</code>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{auction.request}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={open ? "warning" : "success"}>
              {open ? "auction open" : "cleared"}
            </Badge>
            <span className="num text-xs text-muted-foreground">
              budget {formatUsd(auction.budgetUsd)} · {auction.policy}
            </span>
          </div>
        </div>
        {open ? (
          <div className="flex items-center gap-3">
            <Progress
              value={(remaining / AUCTION_WINDOW_MS) * 100}
              className="h-1"
              indicatorClassName="bg-warning"
            />
            <span className="num shrink-0 text-xs text-warning">
              {(remaining / 1000).toFixed(1)}s
            </span>
          </div>
        ) : (
          winnerHandle && (
            <div className="flex items-center gap-2 text-sm">
              <Trophy className="h-4 w-4 text-primary" weight="fill" />
              <span className="text-muted-foreground">winner</span>
              <span className="font-mono font-medium">{winnerHandle}</span>
            </div>
          )
        )}
      </CardHeader>

      <CardContent className="space-y-2 p-3">
        <AnimatePresence initial={false}>
          {ordered.map((bid, i) => {
            const leading = open && i === 0 && bid.status !== "ineligible";
            const won = !open && bid.handle === winnerHandle;
            const ineligible = bid.status === "ineligible";
            return (
              <motion.div
                key={bid.handle}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                className={cn(
                  "flex items-center justify-between rounded-md border px-4 py-3",
                  leading || won
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card",
                  ineligible && "opacity-55",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="num w-5 text-sm text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{bid.handle}</span>
                      {(leading || won) && (
                        <Badge variant="default" className="gap-1">
                          <Trophy className="h-3 w-3" weight="fill" />
                          {won ? "won" : "leading"}
                        </Badge>
                      )}
                      {ineligible && (
                        <Badge variant="destructive" className="gap-1">
                          <Prohibit className="h-3 w-3" weight="fill" />
                          no bond
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 text-primary" weight="fill" />
                        <span className="num">{bid.reputation}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-success" weight="fill" />
                        <span className="num">{formatUsdCompact(bid.bondUsd)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Lightning className="h-3 w-3 text-warning" weight="fill" />
                        <span className="num">{bid.etaMs}ms</span>
                      </span>
                    </div>
                  </div>
                </div>
                <span
                  className={cn(
                    "num text-base font-semibold",
                    leading || won ? "text-primary" : "text-foreground",
                  )}
                >
                  {formatUsd(bid.priceUsd)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {open && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="mt-1 w-full">
                <Gavel className="h-4 w-4" weight="fill" />
                Place a competing bid
              </Button>
            </DialogTrigger>
            <PlaceBidDialog auction={auction} />
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

function PlaceBidDialog({ auction }: { auction: Auction }) {
  const [price, setPrice] = React.useState(
    Math.max(0.05, Number((auction.budgetUsd * 0.25).toFixed(2))),
  );

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Bid on {auction.capability}</DialogTitle>
        <DialogDescription>
          Eligible bidders must hold a quality bond and an ERC-8004 identity. Your
          bid settles through tiagoh&apos;s cascade + revenue-split rails if you win.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Your price</span>
          <span className="num text-lg font-semibold text-primary">
            {formatUsd(price)}
          </span>
        </div>
        <Slider
          value={[price]}
          min={0.05}
          max={auction.budgetUsd}
          step={0.01}
          onValueChange={(v) => setPrice(v[0] ?? price)}
        />
        <p className="num text-xs text-muted-foreground">
          budget ceiling {formatUsd(auction.budgetUsd)} · policy {auction.policy}
        </p>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button
            onClick={() =>
              toast.success("Bid submitted", {
                description: `Signed bid at ${formatUsd(price)} entered the auction.`,
              })
            }
          >
            Submit signed bid
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
