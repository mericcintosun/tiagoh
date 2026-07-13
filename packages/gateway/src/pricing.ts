import type { TiagohConfig, ToolPrice } from "@tiagoh/core";

/** Look up the advertised price for a tool; undefined = free. */
export function priceForTool(config: TiagohConfig, tool: string): ToolPrice | undefined {
  return config.tools.find((t) => t.name === tool);
}

/** Inject per-tool prices into an MCP `tools/list` response under `_meta.tiagoh`. */
export function annotatePrices<T extends { name: string; _meta?: Record<string, unknown> }>(
  config: TiagohConfig,
  tools: T[],
): T[] {
  return tools.map((tool) => {
    const price = priceForTool(config, tool.name);
    if (!price) return tool;
    return {
      ...tool,
      _meta: { ...(tool._meta ?? {}), tiagoh: { priceUsd: price.priceUsd, asset: config.asset } },
    };
  });
}
