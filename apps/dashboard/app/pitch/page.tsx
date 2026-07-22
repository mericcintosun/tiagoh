"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Lightning,
  ShieldCheck,
  TreeStructure,
  Star,
  Receipt,
  CurrencyBtc,
  CheckCircle,
} from "@phosphor-icons/react";

import { LedgerMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const serif = { fontFamily: "var(--font-fraunces), Georgia, serif" } as const;

// ── slide chrome ────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs uppercase tracking-[0.28em] text-primary">
      {children}
    </span>
  );
}

function Slide({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-6">
      {children}
    </div>
  );
}

// ── the eight slides ────────────────────────────────────────────────────────

function SlideTitle() {
  return (
    <Slide>
      <Eyebrow>GOAT Builder Application</Eyebrow>
      <h1
        className="mt-6 text-6xl font-semibold tracking-tight md:text-8xl"
        style={serif}
      >
        tiagoh
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">
        Get paid every time an AI agent calls your tool. The money settles on
        Bitcoin, through GOAT.
      </p>
      <p className="mt-10 text-sm text-muted-foreground">
        A two minute walk through. Use the arrow keys, or the buttons below.
      </p>
    </Slide>
  );
}

function SlideProblem() {
  return (
    <Slide>
      <Eyebrow>01 / The problem</Eyebrow>
      <h2
        className="mt-5 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        Agents can think. They cannot pay for a single tool call.
      </h2>
      <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        There are thousands of tools for AI agents today, and almost all of them
        are free. The reason is simple. There was never a clean way to charge an
        agent for one call, so builders keep giving their best work away.
      </p>
    </Slide>
  );
}

function SlideBuilt() {
  return (
    <Slide>
      <Eyebrow>02 / What we built</Eyebrow>
      <h2
        className="mt-5 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        One command turns any tool into a paid tool.
      </h2>
      <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        You keep your tool exactly as it is. tiagoh puts a paywall in front of
        it. An agent pays a few cents for each call, and only when the call
        actually works.
      </p>
      <div className="mt-8 inline-flex w-fit items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-3">
        <span className="text-primary">$</span>
        <code className="num text-sm md:text-base">tiagoh wrap ./my-server</code>
      </div>
    </Slide>
  );
}

function SlideHow() {
  const steps = [
    "The tool answers the call with a price.",
    "The agent checks its budget and signs the payment.",
    "The tool runs first.",
    "We charge only if it succeeds.",
    "The receipt is written on GOAT.",
  ];
  return (
    <Slide>
      <Eyebrow>03 / How it works</Eyebrow>
      <h2
        className="mt-5 flex items-center gap-3 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        <Lightning weight="fill" className="h-8 w-8 shrink-0 text-primary" />
        Pay per call with x402. Settle on GOAT.
      </h2>
      <ol className="mt-8 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-4">
            <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 text-xs text-primary">
              {i + 1}
            </span>
            <span className="text-base leading-relaxed text-foreground/90 md:text-lg">
              {s}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-base text-[hsl(var(--flow))]">
        A call that fails is never paid.
      </p>
    </Slide>
  );
}

function SlideTrust() {
  const items = [
    {
      Icon: TreeStructure,
      title: "Tools pay tools",
      body: "One tool can buy from another. A single budget covers the whole chain.",
    },
    {
      Icon: ShieldCheck,
      title: "Quality bonds",
      body: "A tool stakes a bond. Bad output refunds the buyer from that bond.",
    },
    {
      Icon: Star,
      title: "Real reputation",
      body: "Every tool earns a score from real receipts, not from marketing.",
    },
    {
      Icon: Receipt,
      title: "Refunds",
      body: "A broken call can be disputed, and the buyer gets the money back.",
    },
  ];
  return (
    <Slide>
      <Eyebrow>04 / More than a paywall</Eyebrow>
      <h2
        className="mt-5 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        We add the trust that raw payments miss.
      </h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.map(({ Icon, title, body }) => (
          <div
            key={title}
            className="rounded-lg border border-border bg-card/60 p-5"
          >
            <Icon weight="duotone" className="h-6 w-6 text-primary" />
            <p className="mt-3 font-medium">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>
    </Slide>
  );
}

function SlideTraction() {
  const tiles = [
    { value: "15", label: "smart contracts live on GOAT mainnet" },
    { value: "63/63", label: "tests passing on real transactions" },
    { value: "1", label: "tool live in the ClawUp market" },
    { value: "0", label: "backend servers, the site reads the chain" },
  ];
  return (
    <Slide>
      <Eyebrow>05 / Where we are</Eyebrow>
      <h2
        className="mt-5 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        It is already live.
      </h2>
      <div className="mt-8 grid grid-cols-2 gap-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-border bg-card/60 p-5"
          >
            <p className="num text-4xl font-semibold text-primary md:text-5xl">
              {t.value}
            </p>
            <p className="mt-2 text-sm leading-snug text-muted-foreground">
              {t.label}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-7 max-w-2xl text-base leading-relaxed text-muted-foreground">
        A full demo runs today. An agent reads a trust score, pays per call,
        checks the result, and asks for a refund when the result is bad.
      </p>
    </Slide>
  );
}

function SlideWhy() {
  return (
    <Slide>
      <Eyebrow>06 / Why GOAT</Eyebrow>
      <h2
        className="mt-5 flex items-center gap-3 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        <CurrencyBtc weight="fill" className="h-8 w-8 shrink-0 text-primary" />
        Bitcoin gives the payments real weight.
      </h2>
      <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        GOAT is a Bitcoin layer two. Every payment and every trust signal
        settles with Bitcoin finality. We also use GOAT session keys for safe
        spending, and BitVM2 for fair refund checks.
      </p>
    </Slide>
  );
}

function SlideNext() {
  const links = [
    { href: "https://tiagoh.vercel.app", label: "Live site" },
    { href: "https://tiagoh.vercel.app/api/mcp", label: "MCP endpoint" },
    { href: "https://github.com/mericcintosun/tiagoh", label: "Code" },
  ];
  return (
    <Slide>
      <Eyebrow>07 / What is next</Eyebrow>
      <h2
        className="mt-5 text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
        style={serif}
      >
        Live on GOAT mainnet.
      </h2>
      <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        The last piece we need is GOAT x402 faucet access. In our code it is a
        single line to switch on. After that we grow the market, bring in more
        real tools, and turn the trust score into something every agent can rely
        on.
      </p>
      <p className="mt-8 flex items-start gap-3 text-xl font-medium leading-snug md:text-2xl">
        <CheckCircle
          weight="fill"
          className="mt-1 h-6 w-6 shrink-0 text-[hsl(var(--flow))]"
        />
        The trust and payment layer for the agent economy, on Bitcoin.
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-3">
        {links.map((l) => (
          <Button key={l.href} asChild variant="outline" size="sm">
            <a href={l.href} target="_blank" rel="noreferrer">
              {l.label}
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </Button>
        ))}
      </div>
      <p className="mt-8 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Referred by kaptan_web3
      </p>
    </Slide>
  );
}

const SLIDES = [
  SlideTitle,
  SlideProblem,
  SlideBuilt,
  SlideHow,
  SlideTrust,
  SlideTraction,
  SlideWhy,
  SlideNext,
];

// ── deck shell ──────────────────────────────────────────────────────────────

const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 44 : -44 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -44 : 44 }),
};

export default function PitchPage() {
  const total = SLIDES.length;
  const [[page, dir], setPage] = React.useState<[number, number]>([0, 0]);

  const goTo = React.useCallback(
    (next: number) => {
      setPage(([cur]) => {
        const clamped = Math.min(Math.max(next, 0), total - 1);
        return [clamped, clamped > cur ? 1 : -1];
      });
    },
    [total],
  );

  const step = React.useCallback(
    (delta: number) => setPage(([cur]) => {
      const clamped = Math.min(Math.max(cur + delta, 0), total - 1);
      return [clamped, delta];
    }),
    [total],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Home") {
        goTo(0);
      } else if (e.key === "End") {
        goTo(total - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, goTo, total]);

  const Current = SLIDES[page];

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 aurora" />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="grain pointer-events-none absolute inset-0" />

      {/* top bar */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <LedgerMark className="h-6 w-6" />
          <span style={serif} className="font-semibold text-foreground">
            tiagoh
          </span>
        </Link>
        <span className="num text-xs text-muted-foreground">
          {String(page + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </header>

      {/* slide */}
      <div className="absolute inset-0 z-10 pt-16 pb-24">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={page}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
            className="h-full w-full"
          >
            <Current />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* progress */}
      <div className="absolute inset-x-0 top-0 z-30 h-0.5 bg-transparent">
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${((page + 1) / total) * 100}%` }}
        />
      </div>

      {/* controls */}
      <footer className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === page
                  ? "w-6 bg-primary"
                  : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70",
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous slide"
            disabled={page === 0}
            onClick={() => step(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="icon"
            aria-label="Next slide"
            disabled={page === total - 1}
            onClick={() => step(1)}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </main>
  );
}
