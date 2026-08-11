/** Wire conventions shared by the gateway, client, and agent. */
export const TIAGOH = {
  /** Per-tool price advertised in MCP `tools/list` under `_meta`. */
  META_KEY: "tiagoh",
  /** Header that carries the cascade parent id downstream. */
  PARENT_ID_HEADER: "x-tiagoh-parent-id",
  /** Header that carries the x402 payment signature on retry. */
  PAYMENT_SIG_HEADER: "x-payment-signature",
  /**
   * The header the x402 v2 spec names for the same thing. Both are accepted, so a standard x402
   * client can pay a tiagoh gateway without knowing anything about tiagoh, and existing tiagoh
   * clients keep working. The value is the base64 `exact`-scheme payment payload.
   */
  X402_PAYMENT_HEADER: "x-payment",
  /**
   * Header echoing the challenge nonce back on the paid retry. This is what makes a payment
   * single-use: the gateway issued the nonce and will accept exactly one settled call against
   * it. Without it the same authorization could be replayed to extract unlimited tool
   * executions — the tool runs before settlement gets a chance to reject the reused
   * authorization, so the seller does the work either way.
   */
  NONCE_HEADER: "x-tiagoh-nonce",
  /**
   * Header carrying the buyer's EIP-712 signature over the receipt. Combined with the seller's
   * counter-signature this makes the receipt evidence rather than the seller's own say-so —
   * see `ReceiptRegistry.anchorReceipt`.
   */
  RECEIPT_SIG_HEADER: "x-tiagoh-receipt-signature",
  /** Response header echoing the settled payment id. */
  PAYMENT_ID_HEADER: "x-tiagoh-payment-id",
  /** Bazaar-compatible discovery document path. */
  DISCOVERY_PATH: "/.well-known/x402.json",
  /** Default GOAT testnet chain id (verify at docs.goat.network). */
  DEFAULT_CHAIN_ID: 48816,
  /** GOAT mainnet chain id. */
  MAINNET_CHAIN_ID: 2345,
  /** Default gateway port. */
  DEFAULT_PORT: 4402,
  /** How long a 402 challenge stays valid, in milliseconds. */
  DEFAULT_CHALLENGE_TTL_MS: 120_000,
} as const;
