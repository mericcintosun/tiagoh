import { BudgetGuard, BudgetExceededError } from "@tiagoh/client";
import { formatMinor, type Minor, type Receipt } from "@tiagoh/core";
import { type Brain, type PricedTool, createBrain } from "./brain.js";
import { type Verifier, createVerifier } from "./verifier.js";

/** What a settled purchase gives the buyer to act on — including its recourse footing. */
export interface Purchase {
  tool: string;
  output: unknown;
  receipt: Receipt;
}

export interface BuyerOptions {
  goal: string;
  /** Session cap in the payment token's minor units. */
  budget: Minor;
  /** Discover priced tools a gateway advertises (from tools/list _meta). */
  discover: () => Promise<PricedTool[]>;
  /** Buy one tool via x402; returns its result and the settled receipt. */
  buy: (tool: string) => Promise<Purchase>;
  brain?: Brain;
  /** Judges whether a paid output is "provably bad" (default: heuristic / ThoughtProof). */
  verify?: Verifier;
  /**
   * Opens recourse for a bad paid call. Wire it to `createOnchainDispute` in `@tiagoh/goat`:
   * the receipt is the evidence, and a buyer-favorable ruling slashes the tool's bond to the
   * buyer. Omit it and a bad output is merely noted, never compensated.
   */
  dispute?: (args: { tool: string; receipt: Receipt; reason: string }) => Promise<void>;
  /**
   * Records the settlement outcome as reputation. Wire it to `createScoreReporter` /
   * `createOnchainReputation`; omit it (the demo default) to stay gas-free.
   */
  feedback?: (args: {
    tool: string;
    receipt: Receipt;
    outcome: "success" | "dispute";
  }) => Promise<void>;
}

export interface BuyerResult {
  live: boolean;
  bought: string[];
  skipped: string[];
  disputed: string[];
  /** Calls whose receipt was not co-signed, so no dispute could be opened for them. */
  unprovable: string[];
  recommendation: string;
}

/**
 * The autonomous buyer loop: discover → decide (by price + bond-capped reputation) → pay under
 * budget → **verify** each paid output → dispute the bad ones → synthesize a recommendation
 * grounded only in the data that passed verification.
 *
 * Two things changed from the naive version, both about honesty:
 *
 *  - The budget is only credited back on a *disputed* call if the receipt can actually back a
 *    dispute. A receipt the seller wrote unilaterally is not evidence, so treating the money as
 *    recovered would be wishful accounting. Those calls are reported as `unprovable` instead.
 *  - Spend is committed when the call settles, not before it is attempted, so a call that never
 *    happened never counts against the budget.
 */
export async function runBuyer(opts: BuyerOptions): Promise<BuyerResult> {
  const brain = opts.brain ?? createBrain();
  const verifier = opts.verify ?? createVerifier();
  const budget = new BudgetGuard(opts.budget);

  const tools = await opts.discover();
  const decision = await brain.decide(opts.goal, tools, opts.budget);

  const purchased: Record<string, unknown> = {};
  const bought: string[] = [];
  const skipped: string[] = [];
  const disputed: string[] = [];
  const unprovable: string[] = [];

  for (const name of decision.buy) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) continue;
    if (!budget.canAfford(tool.amount)) {
      skipped.push(name);
      continue;
    }

    try {
      const purchase = await opts.buy(name);
      budget.charge(tool.amount); // committed only once the call actually settled
      bought.push(name);

      const verdict = await verifier.verify({ tool: name, args: {}, output: purchase.output });
      if (verdict.ok) {
        purchased[name] = purchase.output;
        await opts.feedback?.({ tool: name, receipt: purchase.receipt, outcome: "success" });
        continue;
      }

      // Provably bad output. Recourse needs a co-signed receipt — without one there is nothing
      // to point an arbiter at, and pretending otherwise would overstate what the agent recovered.
      const cosigned = Boolean(purchase.receipt.payerSignature && purchase.receipt.payeeSignature);
      if (!cosigned) {
        unprovable.push(name);
        continue;
      }

      disputed.push(name);
      await opts.dispute?.({
        tool: name,
        receipt: purchase.receipt,
        reason: verdict.reason ?? "bad output",
      });
      await opts.feedback?.({ tool: name, receipt: purchase.receipt, outcome: "dispute" });
      budget.refund(tool.amount);
    } catch (err) {
      // Adapt: an over-budget rejection is fed back; the agent works with what it bought.
      if (err instanceof BudgetExceededError) skipped.push(name);
      else throw err;
    }
  }

  const recommendation = await brain.synthesize(opts.goal, purchased);
  return { live: brain.live, bought, skipped, disputed, unprovable, recommendation };
}

/** Human-readable spend summary for logs. */
export function formatSpend(spent: Minor): string {
  return formatMinor(spent);
}
