import { serializeMinor, toolPriceMinor, type TiagohConfig } from "@tiagoh/core";

/** Build the Bazaar-compatible discovery document served at /.well-known/x402.json. */
export function buildDiscoveryDocument(config: TiagohConfig) {
  return {
    x402Version: 1,
    network: `goat:${config.chainId}`,
    asset: config.asset,
    assetDecimals: config.assetDecimals,
    payTo: config.payTo,
    resources: config.tools.map((t) => ({
      resource: `tool:${t.name}`,
      description: t.description ?? t.name,
      // Exact integer minor units — the same number the receipt and the chain will carry.
      price: {
        amount: serializeMinor(toolPriceMinor(config, t.name) ?? 0n),
        asset: config.asset,
        assetDecimals: config.assetDecimals,
      },
      mimeType: "application/json",
    })),
  };
}
