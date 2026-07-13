import { cn } from "@/lib/utils";
import type { StatTile } from "@/lib/mock";
import { Reveal } from "@/components/reveal";

const ACCENT: Record<StatTile["accent"], string> = {
  primary: "text-primary",
  flow: "text-flow",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

const RULE: Record<StatTile["accent"], string> = {
  primary: "bg-primary",
  flow: "bg-flow",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

export function StatTiles({
  tiles,
  className,
}: {
  tiles: StatTile[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4", className)}>
      {tiles.map((t, i) => (
        <Reveal
          key={t.label}
          delay={i * 0.05}
          className="relative flex flex-col gap-1 bg-card p-5"
        >
          <span className={cn("absolute left-0 top-5 h-6 w-0.5", RULE[t.accent])} />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t.label}
          </span>
          <span className={cn("num text-2xl font-semibold tracking-tight", ACCENT[t.accent])}>
            {t.value}
          </span>
          <span className="text-xs text-muted-foreground">{t.sub}</span>
        </Reveal>
      ))}
    </div>
  );
}
