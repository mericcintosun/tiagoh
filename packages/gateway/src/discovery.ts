import { serializeMinor, toolPriceMinor, type TiagohConfig } from "@tiagoh/core";

/**
 * Build the Bazaar-compatible discovery document served at /.well-known/x402.json.
 *
 * Each resource carries a full x402 v2 `accepts` entry, so a client that has never heard of
 * tiagoh can read this document and know exactly how to pay: the scheme, the CAIP-2 network, the
 * asset, the destination, and that the transfer method is ERC-3009.
 */
export function buildDiscoveryDocument(config: TiagohConfig) {
  const network = `eip155:${config.chainId}`;
  const settleTo = config.settler ?? config.payTo;

  return {
    x402Version: 2,
    network,
    asset: config.asset,
    assetDecimals: config.assetDecimals,
    payTo: config.payTo,
    settleTo,
    resources: config.tools.map((t) => {
      const amount = serializeMinor(toolPriceMinor(config, t.name) ?? 0n);
      return {
        resource: `tool:${t.name}`,
        description: t.description ?? t.name,
        // Exact integer minor units — the same number the receipt and the chain will carry.
        price: {
          amount,
          asset: config.asset,
          assetDecimals: config.assetDecimals,
        },
        mimeType: "application/json",
        accepts: [
          {
            scheme: "exact" as const,
            network,
            amount,
            asset: config.asset,
            payTo: settleTo,
            maxTimeoutSeconds: 120,
            extra: { assetTransferMethod: "eip3009" as const },
          },
        ],
      };
    }),
  };
}
