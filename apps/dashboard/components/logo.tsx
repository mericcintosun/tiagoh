import { cn } from "@/lib/utils";

/**
 * tiagoh wordmark — lowercase mono `tiagoh` + a small ledger/cascade mark.
 * Gold mark on charcoal. The mark is three cascading nodes joined by a cyan flow line.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LedgerMark className="h-6 w-6" />
      {showWordmark && (
        <span className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
          tiagoh
        </span>
      )}
    </span>
  );
}

export function LedgerMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* cascade flow line (cyan) */}
      <path
        d="M5 5.5 L12 12 L19 18.5"
        stroke="hsl(var(--flow))"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* cascading value nodes (gold) */}
      <circle cx="5" cy="5.5" r="2.4" fill="hsl(var(--primary))" />
      <circle cx="12" cy="12" r="2.4" fill="hsl(var(--primary))" />
      <circle cx="19" cy="18.5" r="2.4" fill="hsl(var(--primary))" />
    </svg>
  );
}
