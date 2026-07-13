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
 * ThoughtProof adapter (pluggable) — POSTs the tool call + output to a ThoughtProof
 * Sentinel-style endpoint that returns an ALLOW / BLOCK decision with a confidence and
 * reason. A BLOCK becomes a failing verdict, which drives the dispute → refund + slash path.
 *
 * The wire call is real: it sends the payload, parses the decision, and maps it. Configure
 * `THOUGHTPROOF_URL` (and optionally `THOUGHTPROOF_API_KEY`). If no endpoint is set, or the
 * request errors or times out, it falls back to the objective heuristic so a verifier outage
 * never blocks settlement. The response mapping accepts the common decision shapes
 * (`decision`/`verdict`/`action` = allow|block|deny, or `allowed`/`blocked` booleans).
 */
export class ThoughtProofVerifier implements Verifier {
  readonly name = "thoughtproof";
  private readonly fallback: HeuristicVerifier;

  constructor(
    private readonly endpoint?: string,
    private readonly opts: { apiKey?: string; timeoutMs?: number; requiredKeys?: Record<string, string[]> } = {},
  ) {
    this.fallback = new HeuristicVerifier(opts.requiredKeys);
  }

  async verify(input: { tool: string; args: unknown; output: unknown }): Promise<Verdict> {
    if (!this.endpoint) return this.fallback.verify(input);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 5000);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({ tool: input.tool, args: input.args, output: input.output }),
        signal: controller.signal,
      });
      if (!res.ok) return this.fallback.verify(input);
      return mapThoughtProofDecision(await res.json());
    } catch {
      // Network error / timeout / abort: fail over to the objective heuristic (fail-safe, not fail-open).
      return this.fallback.verify(input);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Normalize a ThoughtProof-style response body into a Verdict. */
function mapThoughtProofDecision(body: unknown): Verdict {
  if (!body || typeof body !== "object") return { ok: true };
  const b = body as Record<string, unknown>;
  const decision = String(b.decision ?? b.verdict ?? b.action ?? "").toLowerCase();
  const reason =
    (typeof b.reason === "string" && b.reason) ||
    (typeof b.evidence === "string" && b.evidence) ||
    "thoughtproof blocked";
  const blocked =
    decision === "block" ||
    decision === "deny" ||
    decision === "reject" ||
    b.blocked === true ||
    b.allowed === false ||
    b.allow === false;
  return blocked ? { ok: false, reason } : { ok: true };
}

export function createVerifier(): Verifier {
  const requiredKeys = {
    get_goat_market_data: ["btcUsd"],
    get_rwa_price: ["priceUsd"],
    get_defi_yields: ["yields"],
  };
  return process.env.THOUGHTPROOF_URL
    ? new ThoughtProofVerifier(process.env.THOUGHTPROOF_URL, {
        apiKey: process.env.THOUGHTPROOF_API_KEY,
        requiredKeys,
      })
    : new HeuristicVerifier(requiredKeys);
}
