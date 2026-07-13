/** Thrown when a payment would breach the per-call or per-session cap. */
export class BudgetExceededError extends Error {
  constructor(
    readonly attemptedUsd: number,
    readonly reason: "per-call" | "per-session",
  ) {
    super(`Payment of $${attemptedUsd} rejected: ${reason} budget exceeded`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Enforces spend caps and aborts a payment *before signing* if it would breach
 * them — an agent can't be drained past its allowance.
 */
export class BudgetGuard {
  private spent = 0;

  constructor(
    private readonly sessionCapUsd: number,
    private readonly perCallCapUsd = Infinity,
  ) {}

  get remainingUsd(): number {
    return Math.max(0, this.sessionCapUsd - this.spent);
  }

  /** Check (without committing) whether a payment is allowed. */
  canAfford(amountUsd: number): boolean {
    return amountUsd <= this.perCallCapUsd && this.spent + amountUsd <= this.sessionCapUsd;
  }

  /** Reserve budget for a payment; throws if it would breach a cap. */
  charge(amountUsd: number): void {
    if (amountUsd > this.perCallCapUsd) throw new BudgetExceededError(amountUsd, "per-call");
    if (this.spent + amountUsd > this.sessionCapUsd) throw new BudgetExceededError(amountUsd, "per-session");
    this.spent += amountUsd;
  }
}
