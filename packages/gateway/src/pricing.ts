import { serializeMinor, toolPriceMinor, type Minor, type TiagohConfig, type ToolPrice } from "@tiagoh/core";

/** Look up the advertised price entry for a tool; undefined = free. */
export function priceForTool(config: TiagohConfig, tool: string): ToolPrice | undefined {
  return config.tools.find((t) => t.name === tool);
}

/** A tool's price in exact minor units; undefined = free. */
export function priceMinorForTool(config: TiagohConfig, tool: string): Minor | undefined {
  return toolPriceMinor(config, tool);
}

/**
 * Inject per-tool prices into an MCP `tools/list` response under `_meta.tiagoh`.
 *
 * The advertised amount is the exact integer the buyer will be charged, in the payment token's
 * minor units. `priceUsd` is kept alongside it purely for humans reading the listing — a client
 * that pays off the float would be paying a different number than the receipt records.
 */
export function annotatePrices<T extends { name: string; _meta?: Record<string, unknown> }>(
  config: TiagohConfig,
  tools: T[],
): T[] {
  return tools.map((tool) => {
    const price = priceForTool(config, tool.name);
    if (!price) return tool;
    const amount = toolPriceMinor(config, tool.name) ?? 0n;
    return {
      ...tool,
      _meta: {
        ...(tool._meta ?? {}),
        tiagoh: {
          amount: serializeMinor(amount),
          asset: config.asset,
          assetDecimals: config.assetDecimals,
          /** Display only — never pay or account off this value. */
          priceUsd: price.priceUsd,
        },
      },
    };
  });
}
