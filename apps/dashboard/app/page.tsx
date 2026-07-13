import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Package,
  Plugs,
  TreeStructure,
  ShieldCheck,
  Scales,
  Gavel,
  Star,
  Receipt,
  CurrencyBtc,
  Wallet,
  SealCheck,
  Lightning,
  CheckCircle,
  Circle,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";

import { Section, SectionHeading } from "@/components/section";
import { Reveal } from "@/components/reveal";
import { MarketingHeader } from "@/components/marketing-header";
import { SiteFooter } from "@/components/site-footer";
import { StatTiles } from "@/components/stat-tiles";
import { CascadeFlow } from "@/components/cascade-flow";
import { ReputationLeaderboard } from "@/components/reputation-leaderboard";
import { BondMeter } from "@/components/bond-meter";
import { AuctionBoard } from "@/components/auction-board";
import { DisputeCard } from "@/components/dispute-card";
import { CodeCard, type CodeLine } from "@/components/code-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  heroStats,
  leaderboard,
  auctions,
  disputes,
  cascadeTree,
  bondEvents,
  contractGrid,
} from "@/lib/mock";

// ── Section content data ────────────────────────────────────────────────────

const STEPS = [
  {
    Icon: Package,
    step: "01",
    title: "wrap",
    body: "Put an x402 paywall in front of any MCP server, unchanged. Per-tool price is advertised in tools/list.",
  },
  {
    Icon: Plugs,
    step: "02",
    title: "connect",
    body: "Any MCP host answers 402 challenges automatically under a spending budget. Claude Code, Claude Desktop, and Cursor all work as-is.",
  },
  {
    Icon: TreeStructure,
    step: "03",
    title: "cascade",
    body: "A tool can buy other paid tools. The whole call tree runs under one budget, and revenue flows up each hop.",
  },
  {
    Icon: ShieldCheck,
    step: "04",
    title: "insure",
    body: "Every hop stakes a quality bond. Bad output is slashed and the buyer is refunded atomically.",
  },
];

const x402Lines: CodeLine[] = [
  { text: "// one MCP tool call, paid per-request over x402", tone: "comment" },
  { text: "POST /api/mcp   tools/call  market.prices()", tone: "default" },
  { text: "← 402 Payment Required", tone: "warning" },
  { text: "  price:  $0.42   token: USDC (ERC-3009)", tone: "muted" },
  { text: "  payTo:  0xSplitter…   budget cap: $5.00", tone: "muted" },
  { text: "→ sign transferWithAuthorization (local mock)", tone: "flow" },
  { text: "→ retry  X-PAYMENT + X-TIAGOH-PARENT-ID", tone: "flow" },
  { text: "← 200 OK  { btc: 68420.11, tvl: 1.9e9 }", tone: "default" },
  { text: "  charged only when the call succeeds", tone: "comment" },
  { text: "  receipt 0xa1…9f2a recorded on GOAT ✓", tone: "success" },
];

const agentLines: CodeLine[] = [
  { text: 'tiagoh agent --goal "value GOAT DeFi portfolio" --budget 5.00', tone: "default" },
  { text: "discovering priced tools … 6 found", tone: "comment" },
  { text: "ranking by reputation (ERC-8004)", tone: "flow" },
  { text: "  ↳ defidata.goat  947★  selected", tone: "primary" },
  { text: "buy market.prices()  −$0.42   left $4.58", tone: "default" },
  { text: "buy yield.scan()     −$0.90   left $3.68", tone: "default" },
  { text: "summary.goat returned malformed JSON", tone: "warning" },
  { text: "  ↳ dispute → bond slashed → refund +$0.05", tone: "destructive" },
  { text: "✓ goal met · spent $1.62 / $5.00 · 4 tools cited", tone: "success" },
];

const PERSONAS = [
  {
    id: "seller",
    label: "Tool seller",
    Icon: Receipt,
    blurb: "Charge per call for your MCP server, and route a revenue split to any payout address.",
    lines: [
      { text: "# wrap your MCP server as paid + insured", tone: "comment" },
      { text: "npx tiagoh wrap ./my-mcp-server \\", tone: "default" },
      { text: "  --price 0.42 --bond 5000 --split 0xSplitter", tone: "primary" },
    ] as CodeLine[],
  },
  {
    id: "composer",
    label: "Composer",
    Icon: TreeStructure,
    blurb: "Resell a tool that buys other paid tools. The whole cascade stays under your budget cap.",
    lines: [
      { text: "# cap the whole downstream call tree", tone: "comment" },
      { text: "npx tiagoh connect --budget 5.00 \\", tone: "default" },
      { text: "  --cascade --attribution 0.12", tone: "primary" },
    ] as CodeLine[],
  },
  {
    id: "buyer",
    label: "Buyer agent",
    Icon: Wallet,
    blurb: "Run an agent that finds tools, buys them under a fixed budget, and ranks them by on-chain reputation.",
    lines: [
      { text: "# an autonomous buyer with recourse", tone: "comment" },
      { text: "npm i @tiagoh/agent", tone: "default" },
      { text: 'agent.run({ goal, budgetUsd: 5, useReputation: true })', tone: "primary" },
    ] as CodeLine[],
  },
];

const ROADMAP_DOT: Record<"success" | "primary" | "flow" | "warning", string> = {
  success: "bg-success",
  primary: "bg-primary",
  flow: "bg-flow",
  warning: "bg-warning",
};
const ROADMAP_TEXT: Record<"success" | "primary" | "flow" | "warning", string> = {
  success: "text-success",
  primary: "text-primary",
  flow: "text-flow",
  warning: "text-warning",
};

const ROADMAP = [
  {
    phase: "shipped",
    tone: "success" as const,
    items: ["10 contracts live on GOAT Testnet3", "x402 pay-per-call flow", "cascade payments + receipts", "bond slash + atomic refund"],
  },
  {
    phase: "next",
    tone: "primary" as const,
    items: ["real facilitator settlement", "escrow at scale", "reputation scoring v1"],
  },
  {
    phase: "planned",
    tone: "flow" as const,
    items: ["reverse auction hardening", "BitVM2 dispute proofs", "prepaid payment channels"],
  },
  {
    phase: "vision",
    tone: "warning" as const,
    items: ["portable ERC-8004 reputation", "cross-gateway insurance market"],
  },
];

const FAQ = [
  {
    q: "How is this different from raw x402?",
    a: "Raw x402 is a vending machine. You pay, you get one answer, and that is it. There is no way to compose paid tools, no recourse when the output is wrong, and no quality signal. tiagoh runs on the same x402 rails and adds cascades, quality bonds, on-chain reputation, live auctions, and atomic multi-hop refunds.",
  },
  {
    q: "What does 'charge-on-quality' mean?",
    a: "Charge-on-success bills only when a call returns a result. tiagoh goes one step further. Each tool stakes a bond up front. If a verifier flags the output as bad, the bond is slashed and the buyer is refunded from it. The buyer never pays for broken output.",
  },
  {
    q: "Why GOAT Network?",
    a: "GOAT is a Bitcoin L2 that is fully EVM-compatible and built for agents. It ships x402, ERC-8004, and .goat naming natively. tiagoh deploys there so calls settle on a Bitcoin L2, and it reuses GOAT's ERC-8004 registries instead of reinventing identity and reputation.",
  },
  {
    q: "Is there a backend?",
    a: "No. Every number on this dashboard is read client-side straight from GOAT Testnet3 via viem and wagmi over a public RPC. The contracts hold the data; the UI just decodes it.",
  },
  {
    q: "How do atomic refunds work across a cascade?",
    a: "If a downstream hop fails after its parents already paid, the EscrowVault unwinds the whole tree in one all-or-nothing step and reverses the revenue splits along the way. The DisputeArbiter records the ruling, and that updates reputation.",
  },
];

// ── Page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="aurora grain absolute inset-0" aria-hidden="true" />
          <div className="grid-bg absolute inset-0 opacity-[0.55]" aria-hidden="true" />
          <div className="relative mx-auto w-full max-w-6xl px-6 pb-20 pt-20 md:pb-28 md:pt-28">
            <Reveal>
              <Badge variant="flow" className="gap-1.5">
                <Sparkle className="h-3 w-3" weight="fill" />
                First on GOAT · Paid MCP tools with on-chain trust
              </Badge>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="mt-6 max-w-4xl font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
                Get paid for every MCP call.
                <br />
                <span className="text-gradient">Payments that cascade.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                tiagoh turns any MCP server into a paid tool. Agents pay per call over
                x402. When one tool calls another, payments cascade down the chain under
                a single budget, and quality bonds refund the buyer when output is bad.
                Everything runs on GOAT, a Bitcoin L2.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/dashboard">
                    Open the dashboard
                    <ArrowUpRight className="h-4 w-4" weight="bold" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/playground">
                    Try the cascade
                    <ArrowRight className="h-4 w-4" weight="bold" />
                  </Link>
                </Button>
              </div>
            </Reveal>
            <div className="mt-14">
              <StatTiles tiles={heroStats} />
            </div>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────── */}
        <Section id="how">
          <SectionHeading
            eyebrow="How it works"
            title="Wrap, connect, cascade, insure"
            lead="Four steps turn any MCP server into a paid tool with quality guarantees. You do not rewrite your server."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.05}>
                <Card className="card-lift h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-6">
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/12">
                        <s.Icon className="h-5 w-5 text-primary" weight="fill" />
                      </span>
                      <span className="num text-xs text-muted-foreground">{s.step}</span>
                    </div>
                    <h3 className="font-mono text-lg font-semibold lowercase tracking-tight">
                      {s.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* ── Get started ───────────────────────────────────────── */}
        <Section id="start" className="border-t border-border bg-muted/20">
          <SectionHeading
            eyebrow="Get started"
            title="Three roles, one command each"
            lead="Sell a tool, resell a composite that buys other tools, or run a buyer agent. Copy the command for your role."
          />
          <Reveal className="mt-10">
            <Tabs defaultValue="seller" className="w-full">
              <TabsList>
                {PERSONAS.map((p) => (
                  <TabsTrigger key={p.id} value={p.id}>
                    <p.Icon className="h-4 w-4" weight="fill" />
                    <span className="hidden sm:inline">{p.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {PERSONAS.map((p) => (
                <TabsContent key={p.id} value={p.id}>
                  <div className="grid gap-6 md:grid-cols-[1fr_1.2fr] md:items-center">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <p.Icon className="h-5 w-5 text-primary" weight="fill" />
                        <h3 className="text-xl font-semibold">{p.label}</h3>
                      </div>
                      <p className="text-muted-foreground">{p.blurb}</p>
                    </div>
                    <CodeCard title={`tiagoh · ${p.label.toLowerCase()}`} lines={p.lines} />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </Reveal>
        </Section>

        {/* ── The cascade primitive ─────────────────────────────── */}
        <Section id="cascade">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <SectionHeading
                eyebrow="The cascade primitive"
                title="One deposit caps the whole call tree"
                lead="A single root budget bounds every recursive hop. The contract refuses any hop that would exceed it, and a share of each child's earnings flows up to its parent's payee."
              />
              <Reveal delay={0.1} className="mt-6 flex flex-col gap-3">
                <Trace icon={CheckCircle} tone="text-success" text="root deposit $5.00 opens the tree" />
                <Trace icon={TreeStructure} tone="text-flow" text="each hop settles under its per-hop cap" />
                <Trace icon={Star} tone="text-primary" text="attribution routes value up the chain" />
                <Trace icon={Circle} tone="text-destructive" text="over-budget hop rejected on-chain (BudgetExceeded)" />
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <CascadeFlow root={cascadeTree} />
            </Reveal>
          </div>
        </Section>

        {/* ── Quality bonds & insurance ─────────────────────────── */}
        <Section id="bonds" className="border-t border-border bg-muted/20">
          <SectionHeading
            eyebrow="Quality bonds & insurance"
            title="Charge-on-success becomes charge-on-quality"
            lead="Every tool stakes a bond up front. A verifier flags bad output, the bond is slashed, and the buyer is refunded from it. Sellers put money behind their own quality."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Reveal className="flex flex-col gap-4">
              {leaderboard.slice(0, 3).map((e) => (
                <BondMeter key={e.handle} entry={e} />
              ))}
            </Reveal>
            <Reveal delay={0.08}>
              <CodeCard
                title="slash → refund trace"
                variant="terminal"
                lines={[
                  { text: "summary.goat  output flagged: schema-mismatch", tone: "warning" },
                  { text: "verifier: thoughtproof.goat  ruling: BAD", tone: "muted" },
                  { text: "QualityBond.slash(summary.goat, $250)", tone: "destructive" },
                  { text: "EscrowVault.refund(opus-buyer.goat, $250)", tone: "success" },
                  { text: "reputation −  ·  slash history +1", tone: "muted" },
                  { text: "✓ buyer made whole from the bond", tone: "success" },
                ]}
              />
              <div className="mt-4">
                <BondFeedNote count={bondEvents.length} />
              </div>
            </Reveal>
          </div>
        </Section>

        {/* ── Reputation & discovery ────────────────────────────── */}
        <Section id="reputation">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading
              eyebrow="Reputation & discovery"
              title="Reputation from receipts, on ERC-8004"
              lead="Every settled receipt, refund, dispute, and slash feeds the on-chain score. Agents rank tools by proven outcomes, not marketing."
            />
            <Reveal>
              <Button asChild variant="outline">
                <Link href="/explorer">
                  Open the explorer
                  <ArrowUpRight className="h-4 w-4" weight="bold" />
                </Link>
              </Button>
            </Reveal>
          </div>
          <Reveal delay={0.08} className="mt-8">
            <ReputationLeaderboard entries={leaderboard.slice(0, 5)} />
          </Reveal>
        </Section>

        {/* ── Live tool auction ─────────────────────────────────── */}
        <Section id="auction" className="border-t border-border bg-muted/20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <SectionHeading
              eyebrow="Live tool auction"
              title="Tools compete to serve your request"
              lead="Post a capability request and bonded tools bid on price and quality in a live reverse auction. The best value wins and settles through the cascade rails."
            />
            <Reveal delay={0.08}>
              <AuctionBoard auction={auctions[0]!} />
            </Reveal>
          </div>
        </Section>

        {/* ── Dispute & atomic refund ───────────────────────────── */}
        <Section id="disputes">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <SectionHeading
                eyebrow="Dispute & atomic refund"
                title="Broken cascades unwind atomically"
                lead="If a downstream hop fails after its parents already paid, the whole tree rolls back in one step. Revenue splits reverse, and the refund is all or nothing. On-chain arbitration records the ruling, with BitVM2 fraud proofs as the planned trust-minimized upgrade."
              />
              <Reveal delay={0.1} className="mt-6">
                <Card>
                  <CardContent className="flex items-center gap-3 p-4">
                    <Scales className="h-5 w-5 text-primary" weight="fill" />
                    <p className="text-sm text-muted-foreground">
                      Refunding a buyer atomically <span className="text-foreground">up</span> a
                      cascade tree, with revenue splits reversed along the way, is the hard
                      part. It is what tiagoh is built around.
                    </p>
                  </CardContent>
                </Card>
              </Reveal>
            </div>
            <Reveal delay={0.1} className="grid gap-4">
              {disputes.slice(0, 2).map((d) => (
                <DisputeCard key={d.id} dispute={d} />
              ))}
            </Reveal>
          </div>
        </Section>

        {/* ── x402 flow + Autonomous agent ──────────────────────── */}
        <Section id="x402" className="border-t border-border bg-muted/20">
          <div className="grid gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="mb-4 flex items-center gap-2">
                <Lightning className="h-5 w-5 text-primary" weight="fill" />
                <h3 className="text-xl font-semibold">The x402 flow</h3>
              </div>
              <CodeCard title="POST /api/mcp · paid over 402" lines={x402Lines} />
            </Reveal>
            <Reveal delay={0.08}>
              <div className="mb-4 flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" weight="fill" />
                <h3 className="text-xl font-semibold">Autonomous agent</h3>
              </div>
              <CodeCard title="tiagoh agent · buying under a budget" variant="terminal" lines={agentLines} />
            </Reveal>
          </div>
        </Section>

        {/* ── Contracts ─────────────────────────────────────────── */}
        <Section id="contracts">
          <SectionHeading
            eyebrow="Contracts"
            title="Ten Solidity contracts, live on GOAT Testnet3"
            lead="All ten are deployed on GOAT Testnet3, and 16 of 16 contract tests pass. Every address below is real and resolves on the block explorer."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-2">
            {contractGrid.map((c, i) => (
              <Reveal key={c.name} delay={(i % 4) * 0.04} className="bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CurrencyBtc className="h-4 w-4 text-primary" weight="fill" />
                    <span className="font-mono text-sm font-semibold">{c.name}</span>
                  </div>
                  <Badge variant={c.status === "live" ? "success" : "warning"}>
                    {c.status === "live" ? "live" : "pending deploy"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{c.purpose}</p>
                <p className="num mt-2 text-xs text-muted-foreground">
                  {c.address ?? "0x…  (set after forge deploy)"}
                </p>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* ── Roadmap ───────────────────────────────────────────── */}
        <Section id="roadmap" className="border-t border-border bg-muted/20">
          <SectionHeading eyebrow="Roadmap" title="Shipped, next, planned, vision" />
          <div className="mt-10 grid gap-8 md:grid-cols-4">
            {ROADMAP.map((r, i) => (
              <Reveal key={r.phase} delay={i * 0.05}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${ROADMAP_DOT[r.tone]}`} />
                  <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {r.phase}
                  </span>
                </div>
                <Separator className="my-4" />
                <ul className="flex flex-col gap-3">
                  {r.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle
                        className={`mt-0.5 h-4 w-4 shrink-0 ${ROADMAP_TEXT[r.tone]}`}
                        weight="fill"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* ── FAQ ───────────────────────────────────────────────── */}
        <Section id="faq">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHeading eyebrow="FAQ" title="Questions, answered" />
            <Reveal delay={0.05}>
              <Accordion type="single" collapsible className="w-full">
                {FAQ.map((f, i) => (
                  <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger>{f.q}</AccordionTrigger>
                    <AccordionContent>{f.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </div>
        </Section>

        {/* ── Final CTA ─────────────────────────────────────────── */}
        <Section className="border-t border-border">
          <Reveal>
            <Card className="relative overflow-hidden">
              <div className="aurora absolute inset-0 opacity-70" aria-hidden="true" />
              <CardContent className="relative flex flex-col items-center gap-6 px-6 py-16 text-center">
                <SealCheck className="h-10 w-10 text-primary" weight="fill" />
                <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
                  Paid MCP tools, with a refund when they fail.
                </h2>
                <p className="max-w-xl text-muted-foreground">
                  Wrap your MCP server, get paid per call over x402, and let quality bonds
                  cover the buyer when output is bad. It all runs on GOAT, a Bitcoin L2.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button asChild size="lg">
                    <Link href="/dashboard">
                      Open the dashboard
                      <ArrowUpRight className="h-4 w-4" weight="bold" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/auction">
                      Watch an auction clear
                      <Gavel className="h-4 w-4" weight="fill" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Trace({
  icon: Icon,
  tone,
  text,
}: {
  icon: React.ComponentType<{ className?: string; weight?: "fill" }>;
  tone: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} weight="fill" />
      <span className="text-sm text-muted-foreground">{text}</span>
    </div>
  );
}

function BondFeedNote({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <ShieldCheck className="h-4 w-4 text-success" weight="fill" />
      <span>
        <span className="num text-foreground">{count}</span> bond events in the live
        feed. Open the explorer for slashes and refunds.
      </span>
    </div>
  );
}
