"use client";

import * as React from "react";
import { Check, Copy } from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(label ? `${label} copied` : "Copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", className)}
      onClick={copy}
      aria-label={`Copy ${label ?? "value"}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" weight="bold" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
