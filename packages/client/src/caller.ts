import type { Receipt } from "@tiagoh/core";
import { createPayingFetch } from "./paying-fetch.js";
import type { BudgetGuard } from "./budget.js";

export interface PricedTool {
  name: string;
  description?: string;
  _meta?: { tiagoh?: { priceUsd: number; asset: string } };
}

export interface CallOptions {
  budget: BudgetGuard;
  /** Signs the x402 authorization for a 402 challenge. */
  sign: (challenge: { priceUsd: number; asset: string }) => Promise<string>;
  /** Cascade parent id for this call (the parent hop's paymentId). */
  parentId?: string | null;
  payer?: string;
  fetchImpl?: typeof fetch;
}

/** Discover the priced tools a gateway advertises (with x402 prices in `_meta`). */
export async function listPaidTools(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<PricedTool[]> {
  const res = await fetchImpl(`${baseUrl}/mcp/tools/list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`tools/list failed: ${res.status}`);
  const body = (await res.json()) as { tools: PricedTool[] };
  return body.tools;
}

/** Call a paid tool, answering the 402 challenge under budget. */
export async function callPaidTool(
  baseUrl: string,
  tool: string,
  args: unknown,
  opts: CallOptions,
): Promise<{ result: unknown; receipt: Receipt }> {
  const payingFetch = createPayingFetch({
    budget: opts.budget,
    sign: opts.sign,
    parentId: opts.parentId,
    fetchImpl: opts.fetchImpl,
  });
  const res = await payingFetch(`${baseUrl}/mcp/tools/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, args, payer: opts.payer }),
  });
  if (!res.ok) throw new Error(`tool ${tool} failed: ${res.status}`);
  return (await res.json()) as { result: unknown; receipt: Receipt };
}
