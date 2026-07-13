import { TIAGOH } from "@tiagoh/core";
import { BudgetGuard } from "./budget.js";

export interface PayingFetchOptions {
  budget: BudgetGuard;
  /** Signs the x402 authorization for a 402 challenge; returns the signature. */
  sign: (challenge: { priceUsd: number; asset: string }) => Promise<string>;
  /** Cascade parent id to propagate downstream, if this call is itself a hop. */
  parentId?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * A paying `fetch`: on a 402 it checks the budget, aborts *before signing* if
 * the price would breach a cap, otherwise signs and retries. Propagates the
 * cascade parent id so downstream receipts link back to their parent.
 */
export function createPayingFetch(opts: PayingFetchOptions) {
  const doFetch = opts.fetchImpl ?? fetch;

  return async function payingFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (opts.parentId) headers.set(TIAGOH.PARENT_ID_HEADER, opts.parentId);

    const first = await doFetch(url, { ...init, headers });
    if (first.status !== 402) return first;

    const challenge = (await first.clone().json()) as { priceUsd: number; asset: string };

    // Budget guard: abort BEFORE signing if it would breach a cap.
    opts.budget.check(challenge.priceUsd);

    const signature = await opts.sign(challenge);
    headers.set(TIAGOH.PAYMENT_SIG_HEADER, signature);
    const paid = await doFetch(url, { ...init, headers });

    // Charge-on-success: commit the spend only if the paid call actually succeeded.
    if (paid.ok) opts.budget.charge(challenge.priceUsd);
    return paid;
  };
}
