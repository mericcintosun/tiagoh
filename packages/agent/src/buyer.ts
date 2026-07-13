import { BudgetGuard, BudgetExceededError } from "@tiagoh/client";
import { type Brain, type PricedTool, createBrain } from "./brain.js";

export interface BuyerOptions {
  goal: string;
  budgetUsd: number;
  /** Discover priced tools a gateway advertises (from tools/list _meta). */
  discover: () => Promise<PricedTool[]>;
  /** Buy one tool via x402; returns its result data. Throws on over-budget. */
  buy: (tool: string) => Promise<unknown>;
  brain?: Brain;
}

export interface BuyerResult {
  live: boolean;
  bought: string[];
  skipped: string[];
  recommendation: string;
}

/**
 * The autonomous buyer loop: discover → decide → pay under budget → adapt on
 * over-budget rejection → synthesize a recommendation grounded in real data.
 */
export async function runBuyer(opts: BuyerOptions): Promise<BuyerResult> {
  const brain = opts.brain ?? createBrain();
  const budget = new BudgetGuard(opts.budgetUsd);

  const tools = await opts.discover();
  const decision = await brain.decide(opts.goal, tools, opts.budgetUsd);

  const purchased: Record<string, unknown> = {};
  const bought: string[] = [];
  const skipped: string[] = [];

  for (const name of decision.buy) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) continue;
    if (!budget.canAfford(tool.priceUsd)) {
      skipped.push(name);
      continue;
    }
    try {
      budget.charge(tool.priceUsd);
      purchased[name] = await opts.buy(name);
      bought.push(name);
    } catch (err) {
      // Adapt: an over-budget rejection is fed back; the agent works with what it bought.
      if (err instanceof BudgetExceededError) skipped.push(name);
      else throw err;
    }
  }

  const recommendation = await brain.synthesize(opts.goal, purchased);
  return { live: brain.live, bought, skipped, recommendation };
}
