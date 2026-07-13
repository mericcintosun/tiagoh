import type { TiagohConfig } from "@tiagoh/core";

/** Build the Bazaar-compatible discovery document served at /.well-known/x402.json. */
export function buildDiscoveryDocument(config: TiagohConfig) {
  return {
    x402Version: 1,
    network: `goat:${config.chainId}`,
    asset: config.asset,
    payTo: config.payTo,
    resources: config.tools.map((t) => ({
      resource: `tool:${t.name}`,
      description: t.description ?? t.name,
      price: { amountUsd: t.priceUsd, asset: config.asset },
      mimeType: "application/json",
    })),
  };
}
