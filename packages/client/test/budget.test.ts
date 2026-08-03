import { describe, it, expect } from "vitest";
import { BudgetGuard, BudgetExceededError } from "../src/budget.js";
import { toMinor } from "@tiagoh/core";

const usd = (v: string) => toMinor(v);

describe("BudgetGuard", () => {
  it("enforces the session cap exactly", () => {
    const b = new BudgetGuard(usd("0.10"));
    b.charge(usd("0.06"));
    expect(b.remaining).toBe(usd("0.04"));
    expect(b.canAfford(usd("0.04"))).toBe(true);
    expect(b.canAfford(usd("0.05"))).toBe(false);
    expect(() => b.charge(usd("0.05"))).toThrow(BudgetExceededError);
  });

  it("enforces a per-call cap independently of the session cap", () => {
    const b = new BudgetGuard(usd("10"), usd("0.05"));
    expect(() => b.charge(usd("0.06"))).toThrow(/per-call/);
    b.charge(usd("0.05"));
    expect(b.spent).toBe(usd("0.05"));
  });

  it("checks without committing", () => {
    const b = new BudgetGuard(usd("1"));
    b.check(usd("0.5"));
    expect(b.spent).toBe(0n);
  });

  /**
   * The reason the ledger is integers: 100 charges of $0.01 must be exactly $1.00. With float
   * dollars the running total lands at 1.0000000000000007, so the last call at a $1.00 cap was
   * rejected — a budget guard whose verdict depended on accumulated rounding error.
   */
  it("does not drift over many small charges", () => {
    const b = new BudgetGuard(usd("1.00"));
    for (let i = 0; i < 100; i++) b.charge(usd("0.01"));
    expect(b.spent).toBe(usd("1.00"));
    expect(b.remaining).toBe(0n);
  });

  it("admits a call that lands exactly on the cap", () => {
    const b = new BudgetGuard(usd("0.03"));
    b.charge(usd("0.01"));
    b.charge(usd("0.02"));
    expect(b.remaining).toBe(0n);
  });

  it("credits a refund back and never goes negative", () => {
    const b = new BudgetGuard(usd("1"));
    b.charge(usd("0.30"));
    b.refund(usd("0.30"));
    expect(b.spent).toBe(0n);
    b.refund(usd("5"));
    expect(b.spent).toBe(0n);
  });

  it("accepts the wire form (minor-unit strings) as well as bigints", () => {
    const b = new BudgetGuard(usd("1"));
    b.charge("20000");
    expect(b.spent).toBe(20_000n);
  });
});
