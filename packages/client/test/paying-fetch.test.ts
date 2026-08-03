import { describe, it, expect } from "vitest";
import { createPayingFetch, type PaymentChallenge } from "../src/paying-fetch.js";
import { BudgetGuard, BudgetExceededError } from "../src/budget.js";
import { TIAGOH, toMinor } from "@tiagoh/core";

function challenge(amount = "20000"): PaymentChallenge {
  return {
    amount,
    asset: "0xtUSD",
    assetDecimals: 6,
    network: "goat:2345",
    payTo: "0xSeller",
    tool: "paid_tool",
    nonce: `0x${"11".repeat(32)}`,
    receiptId: `0x${"22".repeat(32)}`,
    expiresAt: Date.now() + 60_000,
  };
}

/** A fetch stub that answers 402 once, then 200, recording the headers it saw. */
function stubFetch(amount = "20000", secondStatus = 200) {
  const seen: Array<Record<string, string>> = [];
  let calls = 0;
  const impl = (async (_url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    seen.push(headers);
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify(challenge(amount)), { status: 402 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: secondStatus });
  }) as unknown as typeof fetch;
  return { impl, seen, get calls() { return calls; } };
}

describe("createPayingFetch", () => {
  it("pays a 402 and echoes the single-use nonce", async () => {
    const stub = stubFetch();
    const budget = new BudgetGuard(toMinor("1"));
    const f = createPayingFetch({ budget, sign: async () => "sig", fetchImpl: stub.impl });

    const res = await f("http://gw/mcp/tools/call", { method: "POST" });
    expect(res.status).toBe(200);
    expect(stub.seen[1][TIAGOH.PAYMENT_SIG_HEADER]).toBe("sig");
    expect(stub.seen[1][TIAGOH.NONCE_HEADER]).toBe(challenge().nonce);
    expect(budget.spent).toBe(20_000n);
  });

  it("aborts BEFORE signing when the price would breach the budget", async () => {
    const stub = stubFetch("900000"); // $0.90
    const budget = new BudgetGuard(toMinor("0.10"));
    let signed = false;
    const f = createPayingFetch({
      budget,
      sign: async () => {
        signed = true;
        return "sig";
      },
      fetchImpl: stub.impl,
    });

    await expect(f("http://gw/mcp/tools/call", { method: "POST" })).rejects.toThrow(
      BudgetExceededError,
    );
    expect(signed).toBe(false); // never handed a signature to an unaffordable call
    expect(stub.calls).toBe(1); // and never retried
  });

  it("does not charge the budget when the paid call fails", async () => {
    const stub = stubFetch("20000", 500);
    const budget = new BudgetGuard(toMinor("1"));
    const f = createPayingFetch({ budget, sign: async () => "sig", fetchImpl: stub.impl });

    await f("http://gw/mcp/tools/call", { method: "POST" });
    expect(budget.spent).toBe(0n); // charge-on-success
  });

  it("pre-signs the receipt when a receipt signer is supplied", async () => {
    const stub = stubFetch();
    const budget = new BudgetGuard(toMinor("1"));
    const f = createPayingFetch({
      budget,
      sign: async () => "sig",
      signReceipt: async (c) => `receipt-sig:${c.receiptId}`,
      fetchImpl: stub.impl,
    });

    await f("http://gw/mcp/tools/call", { method: "POST" });
    expect(stub.seen[1][TIAGOH.RECEIPT_SIG_HEADER]).toBe(`receipt-sig:${challenge().receiptId}`);
  });

  it("propagates the cascade parent id on the first attempt", async () => {
    const stub = stubFetch();
    const budget = new BudgetGuard(toMinor("1"));
    const f = createPayingFetch({
      budget,
      sign: async () => "sig",
      parentId: "0xparent",
      fetchImpl: stub.impl,
    });

    await f("http://gw/mcp/tools/call", { method: "POST" });
    expect(stub.seen[0][TIAGOH.PARENT_ID_HEADER]).toBe("0xparent");
  });

  it("passes non-402 responses straight through", async () => {
    const impl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const budget = new BudgetGuard(toMinor("1"));
    const f = createPayingFetch({ budget, sign: async () => "sig", fetchImpl: impl });
    expect((await f("http://gw/x")).status).toBe(200);
    expect(budget.spent).toBe(0n);
  });
});
