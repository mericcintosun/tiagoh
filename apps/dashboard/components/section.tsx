import * as React from "react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/reveal";

/** Section wrapper — consistent vertical rhythm + max width for the landing page. */
export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("py-20 md:py-28", className)}>
      <div className="mx-auto w-full max-w-6xl px-6">{children}</div>
    </section>
  );
}

/** Eyebrow + heading + optional lead — the standard section header. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  className,
  align = "left",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <Reveal
      className={cn(
        "flex flex-col gap-3",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      {eyebrow && (
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </span>
      )}
      <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
        {title}
      </h2>
      {lead && (
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          {lead}
        </p>
      )}
    </Reveal>
  );
}
