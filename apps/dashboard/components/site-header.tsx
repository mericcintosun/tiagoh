"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CurrencyBtc } from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { ChainBadge } from "@/components/chain-badge";

const ROUTES = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Explorer", href: "/explorer" },
  { label: "Playground", href: "/playground" },
  { label: "Auction", href: "/auction" },
  { label: "Disputes", href: "/disputes" },
];

/** App-shell header — route nav + live chain badge + theme toggle. */
export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border glass">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-6">
        <Link href="/" aria-label="tiagoh home" className="shrink-0">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {ROUTES.map((r) => {
            const active = pathname === r.href;
            return (
              <Link
                key={r.href}
                href={r.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/12 text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 font-mono text-xs text-muted-foreground sm:inline-flex">
            <CurrencyBtc className="h-4 w-4 text-primary" weight="fill" />
            GOAT mainnet
          </span>
          <ChainBadge />
          <ModeToggle />
        </div>
      </div>

      {/* mobile route row */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-border px-6 py-2 md:hidden">
        {ROUTES.map((r) => {
          const active = pathname === r.href;
          return (
            <Link
              key={r.href}
              href={r.href}
              className={cn(
                "shrink-0 rounded-md px-3 py-1 text-xs font-medium",
                active
                  ? "bg-primary/12 text-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              {r.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
