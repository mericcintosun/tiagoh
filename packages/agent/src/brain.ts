import Anthropic from "@anthropic-ai/sdk";
import { formatMinor, parseMinor, type Minor } from "@tiagoh/core";

export interface PricedTool {
  name: string;
  description: string;
  /** Exact price in the payment token's minor units. */
  amount: Minor;
  /**
   * Bond-capped on-chain reputation, normalized to 0..1. Read it from
   * `ReputationScorer.scoreOfTool` — a score a tool has not collateralized is worth nothing,
   * which is what stops a fresh Sybil from looking trustworthy.
   */
  reputation?: number;
}

export interface BuyDecision {
  buy: string[];
  reasoning: string;
}

/**
 * The reasoning backend. `SimulatedBrain` is the free, clearly-labeled default;
 * `ClaudeBrain` runs the exact same loop with real Claude when a key is set.
 * Swapping is a one-line change (`TIAGOH_AGENT_LIVE=1`).
 */
export interface Brain {
  readonly live: boolean;
  decide(goal: string, tools: PricedTool[], budget: Minor): Promise<BuyDecision>;
  synthesize(goal: string, purchased: Record<string, unknown>): Promise<string>;
}

/** Offline, deterministic reasoning — grounded in the real prices it sees. */
export class SimulatedBrain implements Brain {
  readonly live = false;

  async decide(_goal: string, tools: PricedTool[], budget: Minor): Promise<BuyDecision> {
    // Greedy by reputation-per-unit-cost, staying under budget. Value is ranked with floats
    // (it is a heuristic), but the spend that decides affordability is exact integer money.
    const value = (t: PricedTool) => (t.reputation ?? 0.5) / Number(t.amount === 0n ? 1n : t.amount);
    const ranked = [...tools].sort((a, b) => value(b) - value(a));
    const buy: string[] = [];
    let spent = 0n;
    for (const t of ranked) {
      if (spent + t.amount <= budget) {
        buy.push(t.name);
        spent += t.amount;
      }
    }
    return {
      buy,
      reasoning: `[simulated] bought ${buy.length} tools within a ${formatMinor(budget)} budget`,
    };
  }

  async synthesize(goal: string, purchased: Record<string, unknown>): Promise<string> {
    return `[simulated] recommendation for "${goal}" grounded in ${Object.keys(purchased).length} purchased tools.`;
  }
}

/** Real Claude (Opus 4.8) — same loop, live reasoning. */
export class ClaudeBrain implements Brain {
  readonly live = true;
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, private model = "claude-opus-4-8") {
    this.client = new Anthropic({ apiKey });
  }

  async decide(goal: string, tools: PricedTool[], budget: Minor): Promise<BuyDecision> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            `Goal: ${goal}\nBudget: ${formatMinor(budget)}\nTools (name, price, reputation):\n` +
            tools
              .map(
                (t) =>
                  `- ${t.name} ${formatMinor(t.amount)} rep=${t.reputation ?? "?"}: ${t.description}`,
              )
              .join("\n") +
            `\nReturn JSON {"buy": string[], "reasoning": string} choosing tools worth buying under budget.`,
        },
      ],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    try {
      return JSON.parse(text) as BuyDecision;
    } catch {
      return { buy: [], reasoning: text };
    }
  }

  async synthesize(goal: string, purchased: Record<string, unknown>): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: "user", content: `Goal: ${goal}\nData purchased: ${JSON.stringify(purchased)}\nWrite a grounded recommendation.` },
      ],
    });
    return msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  }
}

export function createBrain(): Brain {
  return process.env.TIAGOH_AGENT_LIVE === "1" && process.env.ANTHROPIC_API_KEY
    ? new ClaudeBrain()
    : new SimulatedBrain();
}
