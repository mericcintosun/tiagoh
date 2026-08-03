import { describe, it, expect } from "vitest";
import { createNonce, deriveReceiptId } from "../src/receipt.js";
import { ReceiptSchema, isCosigned } from "../src/models.js";

const base = {
  payer: "0xBuyer",
  payee: "0xSeller",
  tool: "get_rwa_price",
  amount: "20000",
  nonce: `0x${"11".repeat(32)}`,
};

describe("deriveReceiptId", () => {
  it("is deterministic — the whole point of idempotent retries", () => {
    expect(deriveReceiptId(base)).toBe(deriveReceiptId({ ...base }));
  });

  it("produces a bytes32-shaped hex id", () => {
    expect(deriveReceiptId(base)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is case-insensitive on addresses, so checksummed and lowercase agree", () => {
    expect(deriveReceiptId({ ...base, payer: "0xBUYER" })).toBe(deriveReceiptId(base));
  });

  /**
   * Every field is bound, so a nonce cannot be redirected at a different tool, price, or
   * counterparty and still produce the receipt the buyer signed.
   */
  it.each([
    ["payer", { payer: "0xSomeoneElse" }],
    ["payee", { payee: "0xOtherSeller" }],
    ["tool", { tool: "get_defi_yields" }],
    ["amount", { amount: "20001" }],
    ["nonce", { nonce: `0x${"22".repeat(32)}` }],
  ])("changes when %s changes", (_label, patch) => {
    expect(deriveReceiptId({ ...base, ...patch })).not.toBe(deriveReceiptId(base));
  });
});

describe("createNonce", () => {
  it("returns a fresh 32-byte value each time", () => {
    const seen = new Set(Array.from({ length: 500 }, () => createNonce()));
    expect(seen.size).toBe(500);
    for (const n of seen) expect(n).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("Receipt schema", () => {
  const receipt = {
    paymentId: deriveReceiptId(base),
    parentId: null,
    tool: "get_rwa_price",
    payer: "0xBuyer",
    payee: "0xSeller",
    amount: "20000",
    asset: "0xtUSD",
    status: "settled" as const,
    createdAt: 1,
  };

  it("accepts integer minor amounts and defaults the token precision", () => {
    const parsed = ReceiptSchema.parse(receipt);
    expect(parsed.amount).toBe("20000");
    expect(parsed.assetDecimals).toBe(6);
  });

  it("rejects a float amount — receipts must carry the exact signed integer", () => {
    expect(() => ReceiptSchema.parse({ ...receipt, amount: "0.02" })).toThrow();
  });

  it("only counts as evidence when both parties signed", () => {
    expect(isCosigned(ReceiptSchema.parse(receipt))).toBe(false);
    expect(
      isCosigned(ReceiptSchema.parse({ ...receipt, payerSignature: "0xa" })),
    ).toBe(false);
    expect(
      isCosigned(ReceiptSchema.parse({ ...receipt, payerSignature: "0xa", payeeSignature: "0xb" })),
    ).toBe(true);
  });
});
