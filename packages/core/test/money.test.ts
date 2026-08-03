import { describe, it, expect } from "vitest";
import {
  toMinor,
  formatMinor,
  parseMinor,
  serializeMinor,
  displayMinor,
  MoneyError,
} from "../src/money.js";

describe("toMinor", () => {
  it("converts major-unit decimals exactly", () => {
    expect(toMinor("1")).toBe(1_000_000n);
    expect(toMinor("0.01")).toBe(10_000n);
    expect(toMinor("0.000001")).toBe(1n);
    expect(toMinor("123.456789")).toBe(123_456_789n);
    expect(toMinor(0.02)).toBe(20_000n);
  });

  it("honours a non-default token precision", () => {
    expect(toMinor("1", 18)).toBe(10n ** 18n);
    expect(toMinor("1.5", 2)).toBe(150n);
    expect(toMinor("7", 0)).toBe(7n);
  });

  it("absorbs float artifacts instead of drifting", () => {
    // The exact value of 0.1 + 0.2 in IEEE-754 doubles.
    expect(toMinor(0.1 + 0.2)).toBe(300_000n);
    expect(toMinor(0.1 + 0.2)).toBe(toMinor("0.3"));
  });

  it("rounds half-up past the token's precision", () => {
    expect(toMinor("0.0000005")).toBe(1n);
    expect(toMinor("0.0000004")).toBe(0n);
    expect(toMinor("1.9999995")).toBe(2_000_000n);
  });

  it("expands exponential notation rather than mangling it", () => {
    expect(toMinor(1e-6)).toBe(1n);
    expect(toMinor("2.5e3")).toBe(2_500_000_000n);
    expect(toMinor(1e-9)).toBe(0n);
  });

  it("handles negatives symmetrically", () => {
    expect(toMinor("-0.25")).toBe(-250_000n);
    expect(formatMinor(toMinor("-0.25"))).toBe("-0.250000");
  });

  it("rejects nonsense loudly rather than silently yielding zero", () => {
    expect(() => toMinor("abc")).toThrow(MoneyError);
    expect(() => toMinor("")).toThrow(MoneyError);
    expect(() => toMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => toMinor("1", -1)).toThrow(MoneyError);
  });
});

describe("formatMinor", () => {
  it("round-trips with toMinor", () => {
    for (const v of ["0", "0.01", "1", "12.345678", "1000000.5"]) {
      expect(formatMinor(toMinor(v))).toBe(Number(v).toFixed(6));
    }
  });

  it("pads sub-unit amounts correctly", () => {
    expect(formatMinor(1n)).toBe("0.000001");
    expect(formatMinor(0n)).toBe("0.000000");
    expect(formatMinor(10n, 2)).toBe("0.10");
    expect(formatMinor(7n, 0)).toBe("7");
  });

  it("displays with a symbol", () => {
    expect(displayMinor(10_000n)).toBe("$0.010000");
  });
});

describe("wire form", () => {
  it("serializes as a base-10 integer string, which JSON can carry", () => {
    const amount = toMinor("0.02");
    const encoded = serializeMinor(amount);
    expect(encoded).toBe("20000");
    expect(JSON.parse(JSON.stringify({ amount: encoded })).amount).toBe("20000");
    expect(parseMinor(encoded)).toBe(amount);
  });

  it("rejects a decimal masquerading as a minor amount", () => {
    // Catching this matters: "0.02" parsed as minor units would be a 1e6 under-charge.
    expect(() => parseMinor("0.02")).toThrow(MoneyError);
    expect(() => parseMinor("1e6")).toThrow(MoneyError);
  });

  it("is idempotent on bigint input", () => {
    expect(parseMinor(42n)).toBe(42n);
  });
});

describe("accumulation", () => {
  it("does not drift over many additions, unlike float dollars", () => {
    let minor = 0n;
    let float = 0;
    for (let i = 0; i < 1000; i++) {
      minor += toMinor("0.01");
      float += 0.01;
    }
    expect(formatMinor(minor)).toBe("10.000000");
    // The float path is visibly off, which is exactly why the ledger is integers.
    expect(float).not.toBe(10);
  });
});
