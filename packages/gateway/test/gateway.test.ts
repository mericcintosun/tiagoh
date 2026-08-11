import { describe, it, expect, beforeEach } from "vitest";
import { TiagohGateway, GatewayError, type PaymentChallenge, type ToolCallResult } from "../src/gateway.js";
import { TiagohConfigSchema, parseMinor, type Receipt } from "@tiagoh/core";

const CONFIG = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: "0xSeller",
  asset: "0xtUSD",
  assetDecimals: 6,
  port: 0,
  tools: [
    { name: "paid_tool", priceUsd: 0.02 },
    { name: "pricier_tool", priceUsd: 0.5 },
    { name: "free_tool", priceUsd: 0 },
  ],
});

interface Harness {
  gateway: TiagohGateway;
  calls: string[];
  settles: string[];
  receipts: Receipt[];
}

function harness(overrides: Partial<ConstructorParameters<typeof TiagohGateway>[0]> = {}): Harness {
  const calls: string[] = [];
  const settles: string[] = [];
  const receipts: Receipt[] = [];
  const gateway = new TiagohGateway({
    config: CONFIG,
    callUpstream: async (tool) => {
      calls.push(tool);
      return { ok: true, tool };
    },
    settle: async ({ paymentId }) => {
      settles.push(paymentId);
      return { txHash: `tx:${settles.length}`, payee: CONFIG.payTo };
    },
    verifyPayment: async () => true,
    onReceipt: (r) => receipts.push(r),
    ...overrides,
  });
  return { gateway, calls, settles, receipts };
}

async function pay(h: Harness, challenge: PaymentChallenge, signature = "sig"): Promise<ToolCallResult> {
  return h.gateway.handleToolCall({
    tool: challenge.tool,
    args: {},
    signature,
    nonce: challenge.nonce,
    payer: "0xBuyer",
  });
}

async function challengeFor(h: Harness, tool = "paid_tool"): Promise<PaymentChallenge> {
  const out = await h.gateway.handleToolCall({ tool, args: {}, payer: "0xBuyer" });
  if (out.kind !== "payment_required") throw new Error("expected a 402");
  return out.challenge;
}

describe("verification is required by default", () => {
  it("refuses to construct a gateway that would run priced tools unverified", () => {
    expect(
      () =>
        new TiagohGateway({
          config: CONFIG,
          callUpstream: async () => ({}),
          settle: async () => ({ payee: CONFIG.payTo }),
        }),
    ).toThrow(GatewayError);
  });

  it("allows an explicit, documented demo opt-out", () => {
    expect(
      () =>
        new TiagohGateway({
          config: CONFIG,
          callUpstream: async () => ({}),
          settle: async () => ({ payee: CONFIG.payTo }),
          allowUnverifiedPayments: true,
        }),
    ).not.toThrow();
  });

  it("does not run the tool when verification fails", async () => {
    const h = harness({ verifyPayment: async () => false });
    const challenge = await challengeFor(h);
    const out = await pay(h, challenge);
    expect(out.kind).toBe("payment_required");
    expect(h.calls).toEqual([]);
    expect(h.settles).toEqual([]);
  });

  it("treats a throwing verifier as a failure, not a pass", async () => {
    const h = harness({
      verifyPayment: async () => {
        throw new Error("facilitator down");
      },
    });
    const challenge = await challengeFor(h);
    expect((await pay(h, challenge)).kind).toBe("payment_required");
    expect(h.calls).toEqual([]);
  });
});

describe("challenge / payment happy path", () => {
  it("answers an unpaid call with a priced, single-use challenge", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    expect(challenge.amount).toBe("20000"); // $0.02 at 6 decimals, exactly
    expect(challenge.assetDecimals).toBe(6);
    expect(challenge.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(challenge.receiptId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h.calls).toEqual([]);
  });

  it("runs and settles a verified paid call", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    const out = await pay(h, challenge);

    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(h.calls).toEqual(["paid_tool"]);
    expect(h.settles).toEqual([out.receipt.paymentId]);
    expect(out.receipt.amount).toBe("20000");
    // The receipt id is the one the buyer was told to sign, not a fresh random value.
    expect(out.receipt.paymentId).toBe(challenge.receiptId);
  });

  it("runs free tools without any payment machinery", async () => {
    const h = harness();
    const out = await h.gateway.handleToolCall({ tool: "free_tool", args: {}, payer: "0xBuyer" });
    expect(out.kind).toBe("ok");
    expect(h.calls).toEqual(["free_tool"]);
    expect(h.settles).toEqual([]);
  });
});

describe("replay protection", () => {
  // The sharpest pre-existing hole: charge-on-success runs the tool before settlement can
  // reject a reused authorization, so replaying one signature extracted unlimited free work.
  it("does not re-run the tool when a settled nonce is replayed", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    const first = await pay(h, challenge);
    const replay = await pay(h, challenge);

    expect(h.calls).toEqual(["paid_tool"]); // executed exactly once
    expect(h.settles).toHaveLength(1); // billed exactly once
    expect(replay).toEqual(first); // and the retry is idempotent
  });

  it("re-challenges an unknown nonce instead of trusting it", async () => {
    const h = harness();
    const out = await h.gateway.handleToolCall({
      tool: "paid_tool",
      args: {},
      signature: "sig",
      nonce: `0x${"ab".repeat(32)}`,
      payer: "0xBuyer",
    });
    expect(out.kind).toBe("payment_required");
    expect(h.calls).toEqual([]);
  });

  it("re-challenges an expired nonce", async () => {
    const h = harness({ challengeTtlMs: 1 });
    const challenge = await challengeFor(h);
    await new Promise((r) => setTimeout(r, 5));
    expect((await pay(h, challenge)).kind).toBe("payment_required");
    expect(h.calls).toEqual([]);
  });

  it("refuses to spend a cheap tool's nonce on an expensive one", async () => {
    const h = harness();
    const cheap = await challengeFor(h, "paid_tool"); // $0.02
    const out = await h.gateway.handleToolCall({
      tool: "pricier_tool", // $0.50 — the nonce was not issued for this
      args: {},
      signature: "sig",
      nonce: cheap.nonce,
      payer: "0xBuyer",
    });
    expect(out.kind).toBe("payment_required");
    expect(h.calls).toEqual([]);
  });

  it("refuses a nonce issued to a different payer", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    const out = await h.gateway.handleToolCall({
      tool: "paid_tool",
      args: {},
      signature: "sig",
      nonce: challenge.nonce,
      payer: "0xSomeoneElse",
    });
    expect(out.kind).toBe("payment_required");
    expect(h.calls).toEqual([]);
  });

  it("collapses concurrent retries of the same nonce into one execution", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const h = harness({
      callUpstream: async (tool) => {
        calls.push(tool);
        await gate;
        return { ok: true };
      },
    });
    h.calls.length = 0;

    const challenge = await challengeFor(h);
    const a = pay(h, challenge);
    const b = pay(h, challenge);
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(calls).toEqual(["paid_tool"]);
    expect(h.settles).toHaveLength(1);
    expect(ra).toEqual(rb);
  });
});

describe("charge-on-success", () => {
  it("never settles a call whose tool threw", async () => {
    const h = harness({
      callUpstream: async () => {
        throw new Error("upstream exploded");
      },
    });
    const challenge = await challengeFor(h);
    await expect(pay(h, challenge)).rejects.toThrow("upstream exploded");
    expect(h.settles).toEqual([]);
  });

  it("lets the buyer retry the same challenge after a failure", async () => {
    let fail = true;
    const h = harness({
      callUpstream: async () => {
        if (fail) {
          fail = false;
          throw new Error("transient");
        }
        return { ok: true };
      },
    });
    const challenge = await challengeFor(h);
    await expect(pay(h, challenge)).rejects.toThrow("transient");

    const out = await pay(h, challenge);
    expect(out.kind).toBe("ok");
    expect(h.settles).toHaveLength(1);
  });
});

describe("co-signed receipts", () => {
  it("counter-signs when the buyer pre-signed, producing dispute-grade evidence", async () => {
    const h = harness({ cosign: async (r) => `seller-sig:${r.paymentId}` });
    const challenge = await challengeFor(h);
    const out = await h.gateway.handleToolCall({
      tool: "paid_tool",
      args: {},
      signature: "sig",
      nonce: challenge.nonce,
      receiptSignature: "buyer-sig",
      payer: "0xBuyer",
    });

    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.receipt.payerSignature).toBe("buyer-sig");
    expect(out.receipt.payeeSignature).toBe(`seller-sig:${out.receipt.paymentId}`);
  });

  it("leaves a receipt unsigned when the buyer did not pre-sign", async () => {
    const h = harness({ cosign: async () => "seller-sig" });
    const challenge = await challengeFor(h);
    const out = await pay(h, challenge);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.receipt.payeeSignature).toBeUndefined();
  });

  it("still serves the call if counter-signing fails", async () => {
    const h = harness({
      cosign: async () => {
        throw new Error("signer offline");
      },
    });
    const challenge = await challengeFor(h);
    const out = await h.gateway.handleToolCall({
      tool: "paid_tool",
      args: {},
      signature: "sig",
      nonce: challenge.nonce,
      receiptSignature: "buyer-sig",
      payer: "0xBuyer",
    });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.receipt.payeeSignature).toBeUndefined();
  });
});

describe("the challenge carries everything a payer needs to sign", () => {
  it("advertises the CAIP-2 network and x402 v2 payment requirements", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    expect(challenge.network).toBe(`eip155:${CONFIG.chainId}`);
    expect(challenge.accepts).toHaveLength(1);
    expect(challenge.accepts[0]).toMatchObject({
      scheme: "exact",
      network: `eip155:${CONFIG.chainId}`,
      amount: "20000",
      asset: CONFIG.asset,
      extra: { assetTransferMethod: "eip3009" },
    });
  });

  it("settles to payTo when no settler is configured", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    expect(challenge.settleTo).toBe(CONFIG.payTo);
    expect(challenge.accepts[0]?.payTo).toBe(CONFIG.payTo);
  });

  it("settles to the settler when one is configured, but still names the seller as payee", async () => {
    // The address that receives the transfer and the address that co-signs the receipt cannot be
    // the same once a contract sits in between, so the challenge has to carry both.
    const config = TiagohConfigSchema.parse({
      ...CONFIG,
      settler: "0xSettler",
    });
    const gateway = new TiagohGateway({
      config,
      callUpstream: async () => ({}),
      settle: async () => ({ payee: config.payTo }),
      verifyPayment: async () => true,
    });
    const out = await gateway.handleToolCall({ tool: "paid_tool", args: {}, payer: "0xBuyer" });
    if (out.kind !== "payment_required") throw new Error("expected a 402");
    expect(out.challenge.settleTo).toBe("0xSettler");
    expect(out.challenge.payTo).toBe(CONFIG.payTo);
    expect(out.challenge.accepts[0]?.payTo).toBe("0xSettler");
  });

  it("echoes the cascade parent, so buyer and seller sign the same receipt struct", async () => {
    // Regression: the challenge used to omit parentId, so on any cascade hop the buyer signed a
    // struct claiming no parent while the seller counter-signed one carrying the real parent.
    // The two signatures covered different messages and anchorReceipt rejected every hop —
    // silently, because a co-signing failure is deliberately non-fatal.
    const h = harness();
    const root = await h.gateway.handleToolCall({ tool: "paid_tool", args: {}, payer: "0xBuyer" });
    if (root.kind !== "payment_required") throw new Error("expected a 402");
    expect(root.challenge.parentId).toBeNull();

    const hop = await h.gateway.handleToolCall({
      tool: "paid_tool",
      args: {},
      payer: "0xBuyer",
      parentId: "parent-payment-id",
    });
    if (hop.kind !== "payment_required") throw new Error("expected a 402");
    expect(hop.challenge.parentId).toBe("parent-payment-id");
  });

  it("gives the same receiptId to the buyer that the settled receipt carries", async () => {
    const h = harness();
    const challenge = await challengeFor(h);
    const out = await pay(h, challenge);
    if (out.kind !== "ok") throw new Error("expected a settled call");
    expect(out.receipt.paymentId).toBe(challenge.receiptId);
  });
});

describe("settlement sees a receipt that is already co-signed", () => {
  it("counter-signs before settling, so an atomic settler can anchor in one transaction", async () => {
    // Signing afterwards would leave the payment and its evidence in separate transactions that
    // can diverge: a paid call whose receipt never anchored.
    const seen: Array<{ payer?: string; payee?: string }> = [];
    const h = harness({
      cosign: async (r) => `seller-sig:${r.paymentId}`,
      settle: async ({ receipt }) => {
        seen.push({ payer: receipt.payerSignature, payee: receipt.payeeSignature });
        return { txHash: "tx:1", payee: CONFIG.payTo };
      },
    });
    const challenge = await challengeFor(h);
    const out = await h.gateway.handleToolCall({
      tool: "paid_tool",
      args: {},
      signature: "sig",
      nonce: challenge.nonce,
      receiptSignature: "buyer-sig",
      payer: "0xBuyer",
    });

    expect(out.kind).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.payer).toBe("buyer-sig");
    expect(seen[0]?.payee).toBe(`seller-sig:${challenge.receiptId}`);
  });

  it("hands settlement the payment header, which is where the authorization lives", async () => {
    const headers: string[] = [];
    const h = harness({
      settle: async ({ signature }) => {
        headers.push(signature);
        return { payee: CONFIG.payTo };
      },
    });
    const challenge = await challengeFor(h);
    await pay(h, challenge, "base64-x402-payload");
    expect(headers).toEqual(["base64-x402-payload"]);
  });

  it("still reports the settled txHash on the returned receipt", async () => {
    const h = harness({ settle: async () => ({ txHash: "0xabc", payee: CONFIG.payTo }) });
    const challenge = await challengeFor(h);
    const out = await pay(h, challenge);
    if (out.kind !== "ok") throw new Error("expected a settled call");
    expect(out.receipt.txHash).toBe("0xabc");
  });
});

describe("verification receives the challenge it is verifying against", () => {
  it("passes the reconstructed challenge, not the fields the payer echoed", async () => {
    // A verifier has to bind `settleTo`, the amount and the nonce to what the gateway *issued*.
    // Trusting anything the payer sent back would let them verify against their own numbers.
    let seen: { settleTo?: string; nonce?: string; amount?: string } = {};
    const h = harness({
      verifyPayment: async ({ challenge }) => {
        seen = {
          settleTo: challenge.settleTo,
          nonce: challenge.nonce,
          amount: challenge.amount,
        };
        return true;
      },
    });
    const challenge = await challengeFor(h);
    await pay(h, challenge);
    expect(seen.settleTo).toBe(CONFIG.payTo);
    expect(seen.nonce).toBe(challenge.nonce);
    expect(seen.amount).toBe("20000");
  });
});

describe("amounts are exact", () => {
  it("prices in integer minor units, never floats", async () => {
    const config = TiagohConfigSchema.parse({
      upstream: { command: "in-process" },
      payTo: "0xSeller",
      asset: "0xtUSD",
      port: 0,
      tools: [{ name: "odd", priceUsd: 0.1 + 0.2 }],
    });
    const gateway = new TiagohGateway({
      config,
      callUpstream: async () => ({}),
      settle: async () => ({ payee: "0xSeller" }),
      verifyPayment: async () => true,
    });
    const out = await gateway.handleToolCall({ tool: "odd", args: {}, payer: "0xBuyer" });
    expect(out.kind).toBe("payment_required");
    if (out.kind !== "payment_required") return;
    expect(out.challenge.amount).toBe("300000");
    expect(parseMinor(out.challenge.amount)).toBe(300_000n);
  });
});
