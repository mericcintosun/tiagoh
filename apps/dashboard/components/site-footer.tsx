import Link from "next/link";
import { CurrencyBtc } from "@phosphor-icons/react/dist/ssr";

import { Logo } from "@/components/logo";

const COLS = [
  {
    title: "Product",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Explorer", href: "/explorer" },
      { label: "Playground", href: "/playground" },
      { label: "Auction", href: "/auction" },
      { label: "Disputes", href: "/disputes" },
    ],
  },
  {
    title: "Primitives",
    links: [
      { label: "Cascade", href: "#cascade" },
      { label: "Quality bonds", href: "#bonds" },
      { label: "Reputation", href: "#reputation" },
      { label: "Live auction", href: "#auction" },
      { label: "Disputes & refund", href: "#disputes" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Get started", href: "#start" },
      { label: "Contracts", href: "#contracts" },
      { label: "x402 flow", href: "#x402" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Paid MCP tools on GOAT. Agents pay per call over x402, payments cascade
            across tool chains, and quality bonds refund bad output.
          </p>
          <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <CurrencyBtc className="h-4 w-4 text-primary" weight="fill" />
            Settled on GOAT Network
          </span>
        </div>

        {COLS.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {col.title}
            </span>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <span className="font-mono">tiagoh mainnet build · v0.1</span>
          <span>Numbers anchored on-chain. Read client-side, no backend.</span>
        </div>
      </div>
    </footer>
  );
}
