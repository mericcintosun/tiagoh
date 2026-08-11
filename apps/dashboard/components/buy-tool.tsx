"use client";

import * as React from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSignTypedData,
  useSwitchChain,
} from "wagmi";
import { erc20Abi, type Address, type Hex } from "viem";
import { ArrowSquareOut, Lightning, Wallet, Warning } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { goatChain } from "@/lib/wagmi";

/**
 * Buy a tool call, in the browser, for real money.
 *
 * This is the one place a human can exercise the claim the rest of the site makes. The important
 * detail is what the wallet is asked for: an **EIP-712 signature**, never a transaction. The
 * visitor authorizes a USDC.e transfer; the gateway relays it and pays the gas. So a wallet
 * holding nothing but the stablecoin — no BTC at all — can complete a purchase, and the "gasless
 * buyer" claim stops being something we assert and becomes something the reader just did.
 */

const USDCE = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8" as Address;
const MCP_ENDPOINT = "/api/mcp";

/** Byte-for-byte the struct FiatTokenV2 hashes. */
const TRANSFER_WITH_AUTHORIZATION = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

interface Challenge {
  amount: string;
  asset: Address;
  settleTo: Address;
  nonce: Hex;
  expiresAt: number;
  network: string;
}

type Phase = "idle" | "quoting" | "signing" | "settling" | "done" | "error";

/** The MCP transport can answer as SSE, so pull the JSON object out of whatever comes back. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("unreadable response from the endpoint");
  return JSON.parse(raw.slice(start, end + 1));
}

async function callTool(
  tool: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: {} },
    }),
  });
  const body = extractJson(await res.text()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "the endpoint returned an error");
  const text = body.result?.content?.[0]?.text;
  if (!text) throw new Error("the endpoint returned no content");
  return JSON.parse(text) as Record<string, unknown>;
}

export function BuyTool({ tool, priceUsd }: { tool: string; priceUsd: number }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();

  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);

  const onGoat = chainId === goatChain.id;

  // Balance and the token's own EIP-712 domain. The domain is read rather than hardcoded: it is
  // what the signature is bound to, and a value that is wrong by one character produces a
  // signature that verifies nowhere, with no useful error to show the user.
  const { data: token } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: USDCE, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0"] },
      { address: USDCE, abi: erc20Abi, functionName: "name" },
      {
        address: USDCE,
        abi: [{ type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const,
        functionName: "version",
      },
    ],
    query: { enabled: Boolean(address) && onGoat },
  });

  const balance = (token?.[0]?.result as bigint | undefined) ?? 0n;
  const domainName = (token?.[1]?.result as string | undefined) ?? "Bridged USDC (Stargate)";
  const domainVersion = (token?.[2]?.result as string | undefined) ?? "2";
  const priceMinor = BigInt(Math.round(priceUsd * 1e6));
  const canAfford = balance >= priceMinor;

  async function buy() {
    setError(null);
    setResult(null);
    try {
      // 1. Quote. An unpaid call answers with a signed challenge rather than an HTTP 402,
      //    because MCP wraps everything in JSON-RPC and a 402 status would break the client.
      setPhase("quoting");
      const quote = await callTool(tool, { "x-tiagoh-payer": address as string });
      if (!quote.paymentRequired) {
        setResult(quote);
        setPhase("done");
        return;
      }
      const encoded = quote.challenge as string;
      const challenge = JSON.parse(atob(encoded)) as Challenge;

      // 2. Sign. This is a signature, not a transaction — no gas leaves the wallet.
      setPhase("signing");
      const now = BigInt(Math.floor(Date.now() / 1000));
      const validAfter = now > 60n ? now - 60n : 0n;
      const validBefore = BigInt(Math.floor(challenge.expiresAt / 1000));
      const signature = await signTypedDataAsync({
        domain: {
          name: domainName,
          version: domainVersion,
          chainId: goatChain.id,
          verifyingContract: USDCE,
        },
        types: TRANSFER_WITH_AUTHORIZATION,
        primaryType: "TransferWithAuthorization",
        message: {
          from: address as Address,
          to: challenge.settleTo,
          value: BigInt(challenge.amount),
          validAfter,
          validBefore,
          nonce: challenge.nonce,
        },
      });

      // 3. Retry with the payment. The gateway verifies it against the chain, runs the tool,
      //    and settles — payment, protocol fee and receipt in one transaction.
      setPhase("settling");
      const payload = btoa(
        JSON.stringify({
          x402Version: 2,
          accepted: {
            scheme: "exact",
            network: challenge.network,
            amount: challenge.amount,
            asset: challenge.asset,
            payTo: challenge.settleTo,
            extra: { assetTransferMethod: "eip3009", name: domainName, version: domainVersion },
          },
          payload: {
            signature,
            authorization: {
              from: address,
              to: challenge.settleTo,
              value: challenge.amount,
              validAfter: validAfter.toString(),
              validBefore: validBefore.toString(),
              nonce: challenge.nonce,
            },
          },
        }),
      );
      const paid = await callTool(tool, {
        "x-tiagoh-payer": address as string,
        "x-payment": payload,
        "x-tiagoh-challenge": encoded,
      });
      if (paid.paymentRequired) {
        throw new Error(String(paid.reason ?? "the gateway did not accept the payment"));
      }
      setResult(paid);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
      setPhase("error");
    }
  }

  const busy = phase === "quoting" || phase === "signing" || phase === "settling";
  const label =
    phase === "quoting"
      ? "getting a quote…"
      : phase === "signing"
        ? "waiting for your signature…"
        : phase === "settling"
          ? "settling on GOAT…"
          : `Buy this call — $${priceUsd.toFixed(2)}`;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Lightning className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm">{tool}</span>
            <Badge variant="secondary">${priceUsd.toFixed(2)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Your wallet signs an authorization. It never sends a transaction, so you pay no gas —
            that is the whole point.
          </p>
        </div>

        {!isConnected ? (
          <Button
            onClick={() => connect({ connector: connectors[0]! })}
            disabled={connecting || !connectors[0]}
            size="sm"
          >
            <Wallet className="mr-2 h-4 w-4" />
            {connectors[0] ? "Connect wallet" : "No wallet found"}
          </Button>
        ) : !onGoat ? (
          <Button size="sm" variant="secondary" onClick={() => switchChain({ chainId: goatChain.id })}>
            Switch to GOAT
          </Button>
        ) : (
          <Button size="sm" onClick={buy} disabled={busy || !canAfford}>
            {label}
          </Button>
        )}
      </div>

      {isConnected && onGoat && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="num">
            {(Number(balance) / 1e6).toFixed(4)} USDC.e
          </span>
          <button className="underline underline-offset-2" onClick={() => disconnect()}>
            disconnect
          </button>
          {!canAfford && (
            <span className="flex items-center gap-1 text-warning">
              <Warning className="h-3.5 w-3.5" />
              You need USDC.e on GOAT to buy — bridge some via Stargate first.
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>what you bought</span>
            <a
              className="inline-flex items-center gap-1 underline underline-offset-2"
              href={`${goatChain.blockExplorers.default.url}/address/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              your settlements <ArrowSquareOut className="h-3 w-3" />
            </a>
          </div>
          <pre className="overflow-x-auto rounded border border-border bg-secondary/30 p-3 text-xs">
            <code>{JSON.stringify(result, null, 2)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
