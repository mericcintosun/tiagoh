import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";

export interface CodeLine {
  text: string;
  tone?: "default" | "muted" | "primary" | "flow" | "success" | "warning" | "destructive" | "comment";
}

const TONE: Record<NonNullable<CodeLine["tone"]>, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  primary: "text-primary",
  flow: "text-flow",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  comment: "text-muted-foreground/70 italic",
};

/**
 * Terminal / code card — mono, ledger chrome, accents in gold/cyan only.
 * Lines are pre-tokenized so we never ship a syntax-highlighter dependency.
 */
export function CodeCard({
  title,
  lines,
  copyText,
  className,
  variant = "code",
}: {
  title: string;
  lines: CodeLine[];
  copyText?: string;
  className?: string;
  variant?: "code" | "terminal";
}) {
  const raw = copyText ?? lines.map((l) => l.text).join("\n");
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          </span>
          <span className="font-mono text-xs text-muted-foreground">{title}</span>
        </div>
        <CopyButton value={raw} label={title} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className="font-mono">
          {lines.map((l, i) => (
            <span key={i} className={cn("block", TONE[l.tone ?? "default"])}>
              {variant === "terminal" && l.tone !== "comment" && (
                <span className="select-none text-primary/70">$ </span>
              )}
              {l.text || " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
