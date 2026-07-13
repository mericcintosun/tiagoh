import * as React from "react";

import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";

/** App-route shell — sticky header + a centered, max-width working area. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 md:py-10">
        {children}
      </main>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
  source,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  source?: "chain" | "stub";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {source && <SourceBadge source={source} />}
        {action}
      </div>
    </div>
  );
}

export function SourceBadge({ source }: { source: "chain" | "stub" }) {
  return (
    <Badge
      variant={source === "chain" ? "flow" : "warning"}
      className={cn("gap-1")}
      title={
        source === "chain"
          ? "Decoded from on-chain events via viem/wagmi"
          : "Live on-chain reads, with typed fallback rows when a read is empty. No backend."
      }
    >
      {source === "chain" ? "on-chain" : "typed stub"}
    </Badge>
  );
}
