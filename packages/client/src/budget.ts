import { formatMinor, parseMinor, type Minor } from "@tiagoh/core";

/** Thrown when a payment would breach the per-call or per-session cap. */
export class BudgetExceededError extends Error {
  constructor(
    readonly attempted: Minor,
    readonly reason: "per-call" | "per-session",
    readonly assetDecimals = 6,
  ) {
    super(`Payment of ${formatMinor(attempted, assetDecimals)} rejected: ${reason} budget exceeded`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Enforces spend caps and aborts a payment *before signing* if it would breach them — an agent
 * cannot be drained past its allowance.
 *
 * All accounting is in exact integer minor units. The previous float-dollar version accumulated
 * IEEE-754 error, so a call sitting exactly on the cap could be allowed or rejected depending on
 * what had been spent before it — a budget guard that is only approximately a guard.
 */
export class BudgetGuard {
  private spentMinor = 0n;

  constructor(
    private readonly sessionCap: Minor,
    private readonly perCallCap: Minor | null = null,
    readonly assetDecimals = 6,
  ) {}

  get remaining(): Minor {
    const left = this.sessionCap - this.spentMinor;
    return left > 0n ? left : 0n;
  }

  get spent(): Minor {
    return this.spentMinor;
  }

  /** Check (without committing) whether a payment is allowed. */
  canAfford(amount: Minor | string): boolean {
    const value = parseMinor(amount);
    if (this.perCallCap !== null && value > this.perCallCap) return false;
    return this.spentMinor + value <= this.sessionCap;
  }

  /** Assert a payment is affordable WITHOUT committing; throws if it would breach a cap. */
  check(amount: Minor | string): void {
    const value = parseMinor(amount);
    if (this.perCallCap !== null && value > this.perCallCap) {
      throw new BudgetExceededError(value, "per-call", this.assetDecimals);
    }
    if (this.spentMinor + value > this.sessionCap) {
      throw new BudgetExceededError(value, "per-session", this.assetDecimals);
    }
  }

  /** Commit a payment against the budget; throws if it would breach a cap. */
  charge(amount: Minor | string): void {
    const value = parseMinor(amount);
    this.check(value);
    this.spentMinor += value;
  }

  /** Credit budget back (e.g. a disputed call was refunded). */
  refund(amount: Minor | string): void {
    const value = parseMinor(amount);
    this.spentMinor = this.spentMinor > value ? this.spentMinor - value : 0n;
  }
}
