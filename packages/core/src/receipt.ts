import { createHash, randomBytes } from "node:crypto";

/**
 * Receipt identity and challenge nonces.
 *
 * A receipt id is **derived**, not random, and that is load-bearing in two places:
 *
 *   - **Idempotency.** A retried HTTP request carrying the same challenge nonce derives the same
 *     receipt id, so re-anchoring is a duplicate the registry rejects rather than a second
 *     receipt for one call. A random UUID per attempt (the previous design) made every retry
 *     look like a fresh billable call.
 *   - **Co-signing.** The buyer must sign the receipt *before* the tool runs — the seller will
 *     not do work against an unsigned bill — so the id has to be computable by both sides from
 *     what the 402 challenge already contains.
 *
 * The digest is SHA-256 rather than keccak because nothing on-chain re-derives it: the registry
 * only needs a unique, mutually-agreed `bytes32`. Keeping it in `node:crypto` lets `@tiagoh/core`
 * stay dependency-free.
 */

/** A 32-byte hex identifier, `0x`-prefixed — directly usable as a Solidity `bytes32`. */
export type Bytes32Hex = `0x${string}`;

/** Fresh, unguessable challenge nonce. The gateway issues one per 402 and accepts it once. */
export function createNonce(): Bytes32Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

/**
 * Deterministic receipt id for one paid call. Binding all five fields means a nonce cannot be
 * reused across a different tool, a different price, or a different counterparty.
 */
export function deriveReceiptId(input: {
  payer: string;
  payee: string;
  tool: string;
  /** Amount in the payment token's minor units, base-10. */
  amount: string;
  nonce: string;
}): Bytes32Hex {
  const canonical = [
    "tiagoh:receipt:v1",
    input.payer.toLowerCase(),
    input.payee.toLowerCase(),
    input.tool,
    input.amount,
    input.nonce.toLowerCase(),
  ].join("\n");
  return `0x${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// NOTE: a receipt's `toolId` is deliberately NOT derived here. It is an on-chain identifier that
// `QualityBond` and `DisputeArbiter` compare against, so it must use the EVM-native keccak256 —
// see `toolId()` in `@tiagoh/goat`. Keeping that in the package that already depends on viem is
// what lets `@tiagoh/core` stay dependency-free, and having exactly one derivation is what stops
// a receipt and a bond from disagreeing about which tool is on the hook.
