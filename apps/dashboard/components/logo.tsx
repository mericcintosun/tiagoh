import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * tiagoh brand — the teal interlocking-knot mark (public/mark.png) + a serif
 * `tiagoh` wordmark.
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
      <LedgerMark className="h-7 w-7" />
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

/** The tiagoh knot mark. */
export function LedgerMark({ className }: { className?: string }) {
  return (
    <Image
      src="/mark.png"
      alt="tiagoh"
      width={40}
      height={42}
      priority
      className={cn("object-contain", className)}
    />
  );
}
