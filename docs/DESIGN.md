# tiagoh — Design System & Frontend Spec

> A dark-first, editorial foundation with an identity entirely its own: **warm charcoal + burnished
> gold + a single cool cyan ("vault / ledger").** shadcn/ui only. It must read as a precise
> financial-trust product — **not** an AI-generated site.

---

## 1. Design principles

1. **Ledger, not lab.** The product is about money, trust, receipts, and settlement. The look is a
   premium ledger / vault: warm neutrals, gold as *value*, mono numerals, tight radii, hairline
   rules. Restraint over decoration.
2. **Avoid the AI-frontend tells.** No indigo→violet gradients, no purple glassmorphism everywhere,
   no rainbow blur blobs, no oversized emoji, no three-pastel hero. One accent (gold) + one cool
   signal (cyan) + strict semantic colors. If it looks like every v0/Lovable demo, it's wrong.
3. **Gold is earned, not sprayed.** Gold marks *action, value, and settlement* — buttons, key
   numbers, active states, the primary CTA. It is never a background wash for whole sections.
4. **Numbers are the hero.** Prices, budgets, splits, scores, hashes — all in mono, tabular figures.
   The data *is* the design (see the `dataviz` skill before building any chart).
5. **Dark-first, but both themes ship.** Warm charcoal dark is the signature; the light theme is a
   real "receipt paper" surface, not an afterthought. Theme-aware via `.dark` class + shadcn.
6. **Motion is confirmation, not flair.** Reveal-on-scroll, a settling pulse, a bid-off tick, a
   cascade line drawing itself. Every animation maps to a real state change. Respect
   `prefers-reduced-motion`.

---

## 2. Color palette — "Vault"

Drop-in `app/globals.css` using the standard shadcn token structure, so every component inherits the
theme for free. Values are HSL channels (no `hsl()` wrapper — shadcn convention).

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* ── tiagoh "Vault" tokens ─────────────────────────────────────────────
     Warm ledger system. Primary = burnished gold (value/settlement).
     `flow` = a single cool cyan, used ONLY for cascade lines + verified state.
     Numbers/hashes = mono. ──────────────────────────────────────────────── */
  :root {
    --background: 40 38% 98%;   /* warm receipt paper */
    --foreground: 28 14% 12%;   /* espresso ink */
    --card: 40 33% 99%;
    --card-foreground: 28 14% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 28 14% 12%;
    --primary: 41 96% 50%;      /* burnished gold */
    --primary-foreground: 30 45% 9%;
    --secondary: 40 22% 94%;
    --secondary-foreground: 28 16% 16%;
    --muted: 40 20% 94%;
    --muted-foreground: 32 8% 40%;
    --accent: 40 60% 91%;
    --accent-foreground: 28 55% 24%;  /* deep gold — safe as text on light */
    --flow: 190 82% 38%;        /* ledger cyan — cascade lines, "verified" */
    --destructive: 4 74% 50%;   /* slash / dispute */
    --destructive-foreground: 0 0% 100%;
    --success: 150 58% 35%;     /* settled / released */
    --success-foreground: 0 0% 100%;
    --warning: 24 92% 50%;      /* pending / 402 challenge (orange, NOT gold) */
    --warning-foreground: 0 0% 100%;
    --border: 38 22% 87%;
    --input: 38 22% 85%;
    --ring: 41 96% 50%;
    --radius: 0.5rem;           /* tight radius → "instrument" precise */
  }

  .dark {
    --background: 28 10% 7%;    /* warm charcoal (NOT blue-black) */
    --foreground: 40 18% 96%;
    --card: 28 9% 10%;
    --card-foreground: 40 18% 96%;
    --popover: 28 10% 9%;
    --popover-foreground: 40 18% 96%;
    --primary: 41 98% 60%;     /* bright gold */
    --primary-foreground: 30 45% 8%;
    --secondary: 28 7% 16%;
    --secondary-foreground: 40 18% 96%;
    --muted: 28 7% 15%;
    --muted-foreground: 34 8% 62%;
    --accent: 28 8% 18%;
    --accent-foreground: 41 96% 66%;
    --flow: 188 88% 56%;
    --destructive: 4 78% 60%;
    --destructive-foreground: 0 0% 100%;
    --success: 150 60% 48%;
    --success-foreground: 30 45% 8%;
    --warning: 30 92% 58%;
    --warning-foreground: 30 45% 8%;
    --border: 28 7% 18%;
    --input: 28 7% 22%;
    --ring: 41 98% 60%;
  }
}

@layer base {
  * { @apply border-border; }
  html { scroll-behavior: smooth; }
  body {
    @apply bg-background text-foreground antialiased;
    font-feature-settings: "rlig" 1, "calt" 1, "tnum" 1, "ss01" 1; /* tnum = tabular numerals */
  }
  ::selection { background: hsl(var(--primary) / 0.26); }
}
```

### Palette semantics (memorize these — consistency is the whole game)

| Token | Meaning in tiagoh | Use for |
| --- | --- | --- |
| `primary` (gold) | value, action, settlement | primary buttons, key figures, active nav, CTA, "paid" |
| `flow` (cyan) | flow + proof | cascade graph lines, "verified on-chain" badges, receipts |
| `success` (green) | released / refunded | settled escrow, released split, refund confirmed |
| `warning` (orange) | pending | 402 challenge, awaiting confirmation, auction open |
| `destructive` (red) | slash / dispute | bond slashed, dispute opened, over-budget rejection |
| `muted` | scaffolding | secondary text, table chrome, hashes |

> **Accessibility:** gold at `L50` (light) and cyan are for *fills, borders, and large numerals* —
> not body text on light backgrounds. For gold-colored text on light surfaces use
> `accent-foreground` (deep gold `28 55% 24%`). Verify every pairing hits WCAG AA. Real content sits
> on solid `card`, never on the glass surface.

---

## 3. Tailwind config

Extend `tailwind.config.ts` with the standard shadcn color mapping, plus these tiagoh-specific
additions so components resolve the new tokens:

```ts
// theme.extend.colors — tiagoh-specific additions on top of the standard shadcn colors:
flow:    "hsl(var(--flow))",
success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
// primary/secondary/muted/accent/destructive/border/input/ring/card/popover: standard shadcn mapping.

// fonts
fontFamily: {
  sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
  mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
  // optional editorial display for hero H1 only (a serif reads "established", anti-AI):
  display: ["var(--font-fraunces)", "var(--font-geist-sans)", "serif"],
},
borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
// keyframes/animation: fade-in, pulse-ring, marquee, flow-dash, float, spin-slow, accordion-*.
// flow-dash uses the cyan `flow` stroke for the animated cascade lines.
plugins: [require("tailwindcss-animate")],
```

---

## 4. Component utilities

The utility classes below layer on top of the tokens. Keep them all — they carry the "Vault" texture
(ledger grid, warm aurora, grain, reveal, card-lift):

```css
@layer components {
  .glass { background: hsl(var(--card) / 0.64); backdrop-filter: blur(14px) saturate(135%);
           -webkit-backdrop-filter: blur(14px) saturate(135%); }

  /* Ledger grid — warm hairlines, evokes an accounting sheet. */
  .grid-bg {
    background-image:
      linear-gradient(hsl(var(--border) / 0.5) 1px, transparent 1px),
      linear-gradient(90deg, hsl(var(--border) / 0.5) 1px, transparent 1px);
    background-size: 28px 28px;
  }

  /* Vault aurora — warm gold + one cool cyan, low opacity. NOT a rainbow. */
  .aurora {
    background:
      radial-gradient(58% 52% at 16% 10%, hsl(var(--primary) / 0.15), transparent 60%),
      radial-gradient(48% 48% at 88% 6%, hsl(var(--flow) / 0.12), transparent 62%),
      radial-gradient(60% 60% at 62% 100%, hsl(var(--primary) / 0.07), transparent 60%);
  }

  /* Fine fractal-noise grain to kill banding on dark gradients. */
  .grain::before {
    content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");
  }

  .text-gradient {
    background: linear-gradient(100deg, hsl(var(--foreground)) 34%, hsl(var(--primary)) 72%, hsl(var(--flow)));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }

  .glow-primary { box-shadow: 0 0 0 1px hsl(var(--primary) / 0.4), 0 0 40px -8px hsl(var(--primary) / 0.5); }

  .reveal { opacity: 0; transform: translateY(14px);
            transition: opacity .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1); }
  .reveal.in { opacity: 1; transform: none; }

  .card-lift { transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
  .card-lift:hover { transform: translateY(-3px); border-color: hsl(var(--primary) / 0.4);
                     box-shadow: 0 12px 40px -18px hsl(var(--primary) / 0.35); }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .reveal { opacity: 1; transform: none; transition: none; }
  * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
}
```

---

## 5. Typography

- **Sans:** Geist Sans (UI, body). Clean, neutral, not an AI tell.
- **Mono:** Geist Mono — **all** numbers, prices, budgets, scores, hashes, code. `tnum` on. This is
  the single strongest "fintech, not AI" signal; use it liberally for data.
- **Display (optional, hero H1 only):** a refined serif (e.g. Fraunces / Instrument Serif) for the
  one big headline. A serif on a trust product reads as *established*. If you skip it, keep Geist
  Sans semibold — never a rounded "friendly" display font.
- **Scale:** hero `text-6xl/7xl` semibold tracking-tight; section H2 `text-3xl/4xl`; eyebrow =
  mono `text-xs uppercase tracking-[0.2em] text-primary`. Body `text-muted-foreground leading-relaxed`.

---

## 6. shadcn/ui component inventory (only these)

**shadcn/ui only — no other component library.**

| Component | Used for |
| --- | --- |
| `button`, `badge`, `card`, `separator` | everywhere (badge = tags: "paid", "bonded", "verified") |
| `accordion` | FAQ |
| `tabs` | Get-started personas, dashboard views |
| `table` | receipts, leaderboard, dispute list, bids |
| `tooltip`, `hover-card` | hash → full value, score → breakdown |
| `slider` | playground budget / attribution % |
| `dialog`, `sheet` | open dispute, place bid, bond details |
| `progress` | bond fill, budget consumed, auction countdown |
| `sonner` (toast) | "settled", "slashed", "refunded" confirmations |
| `avatar` | agent / tool identity (with `.goat` handle) |
| `chart` (shadcn Recharts) | revenue over time, reputation distribution — read `dataviz` skill first |

Custom components: `payment-graph`, `cascade-flow`, `receipts-table`, `stat-tiles`, `logo`,
`mode-toggle`, `site-header`, `marketing-header`, `reveal`, `copy-button`, `auction-board`,
`reputation-leaderboard`, `bond-meter`, `dispute-card`.

---

## 7. Layout map

Build the landing in `apps/dashboard/app/page.tsx` with reusable `Section` / `Reveal` / `Feat`
helpers, a hero with `aurora` + `grain`, an editorial hover-list for features, and a de-boxed
timeline for the roadmap.

**Landing (`/`)**
1. `MarketingHeader` (sticky, glass, mode-toggle)
2. `CinematicIntro` (optional)
3. **Hero** — H1 (display serif): *"Payments that cascade. Trust that settles."* Sub: tiagoh is the
   insured settlement layer for MCP on GOAT — pay per call over x402, cascade through insured,
   reputation-ranked supply chains, settled with Bitcoin finality. Stat tiles: `contracts live`,
   `real x402`, `N-hop insured`, `Bitcoin-settled`.
4. **How it works** — Steps: `wrap → connect → cascade → insure`.
5. **Get started** — 3 personas (seller / composer / buyer agent), copy-paste commands.
6. **The cascade primitive** — budget tree + recursive attribution, with a verified trace block.
7. **Quality bonds & insurance** *(new)* — charge-on-quality; bond-meter visual; slash→refund trace.
8. **Reputation & discovery** *(new)* — leaderboard preview; "reputation from receipts, on ERC-8004".
9. **Live tool auction** *(new)* — the bid-off board; "tools compete to serve your request".
10. **Dispute & atomic refund** *(new)* — broken-cascade unwind diagram; BitVM2 arbitration note.
11. **x402 flow** — the code card (one tool call, paid over 402; accents in gold/cyan).
12. **Autonomous agent** — the terminal card (Claude buys under budget, reads reputation, disputes bad output).
13. **Contracts** — grid of GOAT-testnet contracts with explorer links.
14. **Roadmap** — de-boxed timeline (shipped / next / planned / vision).
15. **FAQ** — accordion.
16. **Final CTA** + **Footer**.

**App routes:** `/dashboard` (revenue + receipts + graph), `/explorer` (leaderboard + stats + bonds),
`/playground` (interactive cascade), `/auction` (live board), `/disputes` (arbiter + refunds).

---

## 8. Iconography & imagery

- **Icons:** `lucide-react` only. Map: `GitBranch`/`Network` = cascade, `ShieldCheck` = bond/
  insurance, `Scale` = dispute, `Gavel`/`TrendingDown` = auction, `Star`/`BadgeCheck` = reputation,
  `Receipt` = receipts, `Bitcoin` = settlement, `Wallet` = budget.
- **No stock illustration, no 3D blobs, no AI-art heroes.** If a hero image is used, prefer a subtle
  isometric/technical render at low opacity behind the aurora, in warm tones.
- **Logo:** a mono wordmark `tiagoh` (lowercase) + a small ledger/cascade mark. Gold on charcoal.

---

## 9. Do / don't

**Do:** warm charcoal dark by default · gold for value/action only · mono tabular numerals
everywhere · hairline `border-border` rules · one cyan for flow/verified · real explorer links ·
`card-lift` on interactive cards · `reveal` on scroll · both themes shipped and checked.

**Don't:** indigo/violet gradients · glassmorphism on everything · gold as a full-section background ·
neon on neon · non-shadcn component kits · emoji as UI · charts without reading the `dataviz` skill ·
horizontal body scroll · color as the *only* signal (pair with icon/label for a11y).

---

## 10. One-paragraph brief (hand this to any implementer)

> Build tiagoh's frontend on Next.js 15 + shadcn/ui using the layout structure, helpers, and motion
> described here. Use the "Vault" tokens: warm charcoal + burnished gold + one cool cyan, tight
> `0.5rem` radius, tabular mono for all numbers, optional serif hero. Gold means value/action/
> settlement and nothing else; cyan means flow/verified; green/orange/red are strictly semantic
> (settled/pending/slashed). Add four sections and four routes for the trust features (bonds,
> reputation, auction, disputes). It must feel like a precise financial-ledger product with Bitcoin
> heritage — never like a generic AI-generated app.
