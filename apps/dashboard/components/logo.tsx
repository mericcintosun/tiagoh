import { cn } from "@/lib/utils";

/**
 * tiagoh brand — a teal interlocking-knot mark (the "linked / cascade" motif)
 * + a serif `tiagoh` wordmark.
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
        <span
          className="text-[17px] font-semibold tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}
        >
          tiagoh
        </span>
      )}
    </span>
  );
}

/** The tiagoh mark: two interlocking rounded loops (teal), scales to any size. */
export function LedgerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <rect x="7.5" y="16" width="22" height="19" rx="9.5" stroke="#2E9E8E" strokeWidth="4.6" />
      <rect x="18.5" y="13" width="22" height="19" rx="9.5" stroke="#2E9E8E" strokeWidth="4.6" />
    </svg>
  );
}
