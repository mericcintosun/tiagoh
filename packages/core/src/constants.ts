/** Wire conventions shared by the gateway, client, and agent. */
export const TIAGOH = {
  /** Per-tool price advertised in MCP `tools/list` under `_meta`. */
  META_KEY: "tiagoh",
  /** Header that carries the cascade parent id downstream. */
  PARENT_ID_HEADER: "x-tiagoh-parent-id",
  /** Header that carries the x402 payment signature on retry. */
  PAYMENT_SIG_HEADER: "x-payment-signature",
  /** Response header echoing the settled payment id. */
  PAYMENT_ID_HEADER: "x-tiagoh-payment-id",
  /** Bazaar-compatible discovery document path. */
  DISCOVERY_PATH: "/.well-known/x402.json",
  /** Default GOAT testnet chain id (verify at docs.goat.network). */
  DEFAULT_CHAIN_ID: 48816,
  /** Default gateway port. */
  DEFAULT_PORT: 4402,
} as const;
