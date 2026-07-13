import { BudgetGuard, BudgetExceededError } from "@tiagoh/client";
import { type Brain, type PricedTool, createBrain } from "./brain.js";
import { type Verifier, createVerifier } from "./verifier.js";

export interface BuyerOptions {
  goal: string;
  budgetUsd: number;
  /** Discover priced tools a gateway advertises (from tools/list _meta). */
  discover: () => Promise<PricedTool[]>;
  /** Buy one tool via x402; returns its result data. Throws on over-budget. */
  buy: (tool: string) => Promise<unknown>;
  brain?: Brain;
  /** Judges whether a paid output is "provably bad" (default: heuristic / ThoughtProof). */
  verify?: Verifier;
  /** Called when a paid output is disputed (opens an on-chain dispute → refund + slash). */
  dispute?: (args: { tool: string; reason: string }) => Promise<void>;
}

export interface BuyerResult {
  live: boolean;
  bought: string[];
  skipped: string[];
  disputed: string[];
  recommendation: string;
}

/**
 * The autonomous buyer loop: discover → decide (by price + reputation) → pay under
 * budget → **verify** each paid output → dispute the bad ones (refund + slash) →
 * synthesize a recommendation grounded only in the data that passed verification.
 */
export async function runBuyer(opts: BuyerOptions): Promise<BuyerResult> {
  const brain = opts.brain ?? createBrain();
  const verifier = opts.verify ?? createVerifier();
  const budget = new BudgetGuard(opts.budgetUsd);

  const tools = await opts.discover();
  const decision = await brain.decide(opts.goal, tools, opts.budgetUsd);

  const purchased: Record<string, unknown> = {};
  const bought: string[] = [];
  const skipped: string[] = [];
  const disputed: string[] = [];

  for (const name of decision.buy) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) continue;
    if (!budget.canAfford(tool.priceUsd)) {
      skipped.push(name);
      continue;
    }
    try {
      budget.charge(tool.priceUsd);
      const output = await opts.buy(name);
      bought.push(name);

      // Verify the paid output; a "provably bad" result is disputed → refund + slash.
      const verdict = await verifier.verify({ tool: name, args: {}, output });
      if (verdict.ok) {
        purchased[name] = output;
      } else {
        disputed.push(name);
        await opts.dispute?.({ tool: name, reason: verdict.reason ?? "bad output" });
        budget.refund(tool.priceUsd); // disputed → refunded
      }
    } catch (err) {
      // Adapt: an over-budget rejection is fed back; the agent works with what it bought.
      if (err instanceof BudgetExceededError) skipped.push(name);
      else throw err;
    }
  }

  const recommendation = await brain.synthesize(opts.goal, purchased);
  return { live: brain.live, bought, skipped, disputed, recommendation };
}
