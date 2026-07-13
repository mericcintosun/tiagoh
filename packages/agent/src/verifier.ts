/**
 * The verifier oracle — decides whether a paid tool's output is "provably bad",
 * which triggers a dispute → escrow refund + bond slash (PRD §5.2/§5.4). Pluggable:
 * the default is a fast heuristic; ThoughtProof (a fellow GOAT grantee) or a swarm of
 * verifier agents can be swapped in for adversarial, model-based judgement.
 */
export interface Verdict {
  ok: boolean;
  reason?: string;
}

export interface Verifier {
  readonly name: string;
  verify(input: { tool: string; args: unknown; output: unknown }): Promise<Verdict>;
}

/**
 * Objective failures only (the safe first pass): empty/null output, an explicit
 * `error` field, malformed JSON, or a result missing the fields a tool must return.
 * Reputation handles the fuzzy long tail; ThoughtProof handles semantic wrongness.
 */
export class HeuristicVerifier implements Verifier {
  readonly name = "heuristic";

  constructor(private readonly requiredKeys: Record<string, string[]> = {}) {}

  async verify({ tool, output }: { tool: string; args: unknown; output: unknown }): Promise<Verdict> {
    if (output == null) return { ok: false, reason: "empty output" };

    // MCP tool results are `{ content: [{ type, text }] }`; unwrap the text payload.
    let payload: unknown = output;
    const c = (output as { content?: Array<{ type?: string; text?: string }> }).content;
    if (Array.isArray(c)) {
      const text = c.find((p) => p.type === "text")?.text;
      if (text == null) return { ok: false, reason: "no text content" };
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      if ("error" in obj) return { ok: false, reason: `tool returned error: ${String(obj.error)}` };
      for (const key of this.requiredKeys[tool] ?? []) {
        if (!(key in obj)) return { ok: false, reason: `missing required field "${key}"` };
      }
    }
    return { ok: true };
  }
}

/**
 * ThoughtProof adapter (pluggable) — sends the tool call + output to a ThoughtProof
 * Sentinel-style endpoint that returns ALLOW / BLOCK with a confidence + evidence
 * chain. Wire the endpoint + key when integrating; falls back to a heuristic here.
 */
export class ThoughtProofVerifier implements Verifier {
  readonly name = "thoughtproof";
  private readonly fallback = new HeuristicVerifier();

  constructor(private readonly endpoint?: string) {}

  async verify(input: { tool: string; args: unknown; output: unknown }): Promise<Verdict> {
    if (!this.endpoint) return this.fallback.verify(input);
    // TODO(thoughtproof): POST { tool, args, output } → ALLOW/BLOCK; map BLOCK → { ok:false }.
    return this.fallback.verify(input);
  }
}

export function createVerifier(): Verifier {
  return process.env.THOUGHTPROOF_URL
    ? new ThoughtProofVerifier(process.env.THOUGHTPROOF_URL)
    : new HeuristicVerifier({
        get_goat_market_data: ["btcUsd"],
        get_rwa_price: ["priceUsd"],
        get_defi_yields: ["yields"],
      });
}
