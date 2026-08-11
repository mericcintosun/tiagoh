import { TIAGOH, parseMinor } from "@tiagoh/core";
import { BudgetGuard } from "./budget.js";

/** The 402 body a gateway answers with. */
export interface PaymentChallenge {
  /** Minor units of `asset`, base-10 integer string. */
  amount: string;
  asset: string;
  assetDecimals: number;
  /** CAIP-2 chain id, e.g. `eip155:2345`. */
  network: string;
  /** The seller's identity — the receipt's payee, and the party that counter-signs it. */
  payTo: string;
  /** Where the payment authorization sends the money (the settler, or `payTo`). */
  settleTo: string;
  tool: string;
  nonce: string;
  receiptId: string;
  /** Cascade parent, echoed by the gateway so the buyer signs the same struct the seller does. */
  parentId: string | null;
  expiresAt: number;
}

export interface PayingFetchOptions {
  budget: BudgetGuard;
  /** Signs the x402 payment authorization for a challenge. */
  sign: (challenge: PaymentChallenge) => Promise<string>;
  /**
   * Signs the receipt this call will produce (EIP-712, over the deterministic `receiptId` in
   * the challenge). The gateway counter-signs, and the result is a receipt neither side can
   * forge — the only kind `DisputeArbiter` accepts as proof of harm. Omit it and the call still
   * works, but the buyer gives up their recourse.
   */
  signReceipt?: (challenge: PaymentChallenge) => Promise<string>;
  /** Cascade parent id to propagate downstream, if this call is itself a hop. */
  parentId?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * A paying `fetch`: on a 402 it checks the budget, aborts *before signing* if the price would
 * breach a cap, otherwise signs and retries — echoing the challenge nonce so the payment is
 * single-use, and pre-signing the receipt so the settled call produces real evidence.
 */
export function createPayingFetch(opts: PayingFetchOptions) {
  const doFetch = opts.fetchImpl ?? fetch;

  return async function payingFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (opts.parentId) headers.set(TIAGOH.PARENT_ID_HEADER, opts.parentId);

    const first = await doFetch(url, { ...init, headers });
    if (first.status !== 402) return first;

    const challenge = (await first.clone().json()) as PaymentChallenge;
    const amount = parseMinor(challenge.amount);

    // Budget guard: abort BEFORE signing if it would breach a cap.
    opts.budget.check(amount);

    const payment = await opts.sign(challenge);
    // Send both header names: `X-PAYMENT` is what the x402 v2 spec calls for (so a standard x402
    // server understands us), and the tiagoh header keeps older gateways working.
    headers.set(TIAGOH.X402_PAYMENT_HEADER, payment);
    headers.set(TIAGOH.PAYMENT_SIG_HEADER, payment);
    // The nonce is what makes the authorization single-use on the seller's side.
    headers.set(TIAGOH.NONCE_HEADER, challenge.nonce);
    if (opts.signReceipt) {
      headers.set(TIAGOH.RECEIPT_SIG_HEADER, await opts.signReceipt(challenge));
    }

    const paid = await doFetch(url, { ...init, headers });

    // Charge-on-success: commit the spend only if the paid call actually succeeded.
    if (paid.ok) opts.budget.charge(amount);
    return paid;
  };
}
