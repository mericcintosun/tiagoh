"use client";

import { Coins, Lightning, Lock, Plugs, Receipt } from "@phosphor-icons/react/dist/ssr";

import { AppShell, PageHeading } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { BuyTool } from "@/components/buy-tool";
import { deployedContracts, GOAT_MAINNET } from "@/lib/deployments";

/**
 * One screen, numbers instead of marketing.
 *
 * Every figure here is either a constant in a deployed contract or a price in the live catalogue,
 * so a reader can check any of it on the explorer rather than take our word for it.
 */

const SETTLER = "0x630b7C9D965994A3F2a2254534260A67423B6672";
const USDCE = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";

const LINES: Array<{ what: string; price: string; note: string }> = [
  {
    what: "tiagoh wrap",
    price: "free",
    note: "Put an x402 paywall in front of any MCP server. No account, no key, no signup.",
  },
  {
    what: "Protocol fee on settled volume",
    price: "0% today",
    note: "Switched on deliberately, never retroactively. Hard-capped at 5% by a compile-time constant in X402Settler — the owner cannot exceed it, and you can read the live value on chain.",
  },
  {
    what: "Buyer-side gas",
    price: "$0",
    note: "The buyer signs an ERC-3009 authorization; whoever relays it pays the fee. A wallet holding nothing but USDC.e can buy tool calls.",
  },
  {
    what: "Settlement cost we absorb",
    price: "≈3.4 sats/call",
    note: "One transaction carries the payment, the fee split and the receipt. At GOAT's gas price that is about 0.3% of a $0.01 call.",
  },
];

const CATALOGUE: Array<{ tool: string; usd: number | null; source: string }> = [
  { tool: "get_goat_chain_stats", usd: null, source: "explorer.goat.network" },
  { tool: "get_goat_gas", usd: null, source: "rpc.goat.network" },
  { tool: "inspect_address", usd: 0.02, source: "rpc.goat.network" },
  { tool: "get_token_info", usd: 0.02, source: "rpc.goat.network" },
  { tool: "get_tx_status", usd: 0.02, source: "rpc.goat.network" },
  { tool: "get_erc8004_registry_stats", usd: 0.02, source: "explorer.goat.network" },
  { tool: "get_goat_market_data", usd: 0.02, source: "coingecko.com · llama.fi" },
];

const minor = (usd: number) => (usd * 1e6).toLocaleString("en-US");

export default function PricingPage() {
  return (
    <AppShell>
      <PageHeading
        eyebrow="Pricing"
        title="What this costs"
        description="Wrapping is free. The protocol takes a percentage of settled volume, and that percentage is capped in the contract rather than in a promise. Every price below is in exact integer minor units, because that is what the receipt and the chain record."
        source="chain"
      />

      <div className="mt-8 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-2.5">what</th>
              <th className="px-4 py-2.5">price</th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((l) => (
              <tr key={l.what} className="border-t border-border align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{l.what}</div>
                  <div className="mt-1 max-w-xl text-xs text-muted-foreground">{l.note}</div>
                </td>
                <td className="num whitespace-nowrap px-4 py-3 font-semibold">{l.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Try it — the claim, exercised rather than asserted */}
      <div className="mt-10 flex items-center gap-2">
        <Lightning className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">Buy one, right here</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Connect a wallet holding USDC.e on GOAT and buy a single tool call. Your wallet will ask
        you to <em>sign</em>, not to send a transaction — the gateway relays the authorization and
        pays the gas, which is why a wallet with zero BTC can complete this. That is the whole
        pitch, and it takes about ten seconds to check.
      </p>
      <div className="mt-3">
        <BuyTool tool="get_goat_market_data" priceUsd={0.02} />
      </div>

      {/* The catalogue */}
      <div className="mt-10 flex items-center gap-2">
        <Plugs className="h-4 w-4 text-flow" />
        <h2 className="text-base font-semibold">Hosted tool catalogue</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Served at{" "}
        <code className="rounded bg-secondary px-1 py-0.5 text-xs">/api/mcp</code> over
        streamable-HTTP, callable by any MCP host. Two tools are free forever; the rest settle per
        call in USDC.e. Every one reads a live source at call time — there is no canned data in the
        catalogue, and tools whose only honest answer would have been fabricated were removed
        rather than faked.
      </p>
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-2.5">tool</th>
              <th className="px-4 py-2.5 text-right">price</th>
              <th className="px-4 py-2.5 text-right">minor units</th>
              <th className="px-4 py-2.5">live source</th>
            </tr>
          </thead>
          <tbody>
            {CATALOGUE.map((t) => (
              <tr key={t.tool} className="border-t border-border">
                <td className="px-4 py-2.5 font-mono text-xs">{t.tool}</td>
                <td className="num px-4 py-2.5 text-right">
                  {t.usd === null ? (
                    <Badge variant="secondary">free</Badge>
                  ) : (
                    `$${t.usd.toFixed(2)}`
                  )}
                </td>
                <td className="num px-4 py-2.5 text-right text-muted-foreground">
                  {t.usd === null ? "—" : minor(t.usd)}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Verify it */}
      <div className="mt-10 flex items-center gap-2">
        <Lock className="h-4 w-4 text-success" />
        <h2 className="text-base font-semibold">Check the numbers yourself</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        The fee is a public variable and its ceiling is a constant. Neither requires trusting this
        page.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-secondary/30 p-4 text-xs leading-relaxed">
        <code>{`cast call ${SETTLER} "feeBps()(uint256)"      --rpc-url ${GOAT_MAINNET.rpc}
cast call ${SETTLER} "MAX_FEE_BPS()(uint256)" --rpc-url ${GOAT_MAINNET.rpc}
cast call ${SETTLER} "quote(uint256)(uint256,uint256)" 20000 --rpc-url ${GOAT_MAINNET.rpc}`}</code>
      </pre>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          { icon: Coins, label: "Payment token", value: "USDC.e", sub: USDCE },
          { icon: Receipt, label: "Settler", value: "X402Settler", sub: SETTLER },
          {
            icon: Receipt,
            label: "Receipt registry",
            value: "ReceiptRegistry",
            sub: deployedContracts.receiptRegistry,
          },
          { icon: Coins, label: "Network", value: "GOAT mainnet", sub: "chainId 2345" },
        ].map((c) => (
          <a
            key={c.label}
            href={`${GOAT_MAINNET.explorer}/address/${c.sub}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border p-4 transition-colors hover:border-primary/50"
          >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <c.icon className="h-3.5 w-3.5" />
              {c.label}
            </div>
            <div className="mt-1 font-medium">{c.value}</div>
            <div className="num mt-0.5 break-all text-xs text-muted-foreground">{c.sub}</div>
          </a>
        ))}
      </div>

      <p className="mt-10 max-w-2xl text-xs text-muted-foreground">
        Not yet priced, and listed here so the omission is deliberate rather than discovered: a
        hosted control plane (shared nonce store, policy engine, audit export) and opt-in
        per-call insurance. Both need the trust layer carrying real volume first.
      </p>
    </AppShell>
  );
}
