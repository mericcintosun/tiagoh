import { describe, it, expect } from "vitest";
import {
  checkChallenge,
  encodeChallenge,
  issueChallenge,
  type SignedChallenge,
} from "../lib/x402-paywall";

/**
 * The hosted paywall keeps no server-side record of the challenges it issues — it signs them and
 * re-checks its own signature on the paid retry. That makes the MAC the whole security boundary:
 * if a challenge can be forged or re-pointed at a different tool, the paywall is decoration.
 * These tests are that boundary.
 */

const SECRET = "test-secret-not-the-production-one";
const BUYER = "0x131d9db0888B1f182d3ffCd91A38333B4117e13c";

const base = {
  tool: "get_token_info",
  amount: "20000",
  asset: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
  assetDecimals: 6,
  network: "eip155:2345",
  payTo: "0x2F633Cfa69Aff8ab0af7237294aC79fd7C47710D",
  settleTo: "0x630b7C9D965994A3F2a2254534260A67423B6672",
  payer: BUYER,
  parentId: null,
};

const expect_ = { tool: base.tool, amount: base.amount, payer: BUYER };

/** Re-encode a challenge after tampering with it, keeping the original signature. */
function tamper(c: SignedChallenge, patch: Partial<SignedChallenge>): string {
  return encodeChallenge({ ...c, ...patch });
}

describe("issuing", () => {
  it("produces a payable challenge with a fresh 32-byte nonce", () => {
    const c = issueChallenge(base, SECRET);
    expect(c.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(c.expiresAt).toBeGreaterThan(Date.now());
    expect(c.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats a nonce", () => {
    // Two calls for the same tool by the same payer must not collide, or the second could never
    // settle — the token would reject the reused authorization nonce.
    const seen = new Set(Array.from({ length: 50 }, () => issueChallenge(base, SECRET).nonce));
    expect(seen.size).toBe(50);
  });

  it("advertises x402 v2 payment requirements pointing at the settler", () => {
    const c = issueChallenge(base, SECRET);
    expect(c.accepts).toHaveLength(1);
    expect(c.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:2345",
      amount: "20000",
      payTo: base.settleTo,
      extra: { assetTransferMethod: "eip3009" },
    });
  });
});

describe("checking", () => {
  it("accepts a challenge it issued", () => {
    const raw = encodeChallenge(issueChallenge(base, SECRET));
    const out = checkChallenge(raw, expect_, SECRET);
    expect(out.ok).toBe(true);
  });

  it("rejects a challenge signed with a different secret", () => {
    const raw = encodeChallenge(issueChallenge(base, "someone-elses-secret"));
    const out = checkChallenge(raw, expect_, SECRET);
    expect(out).toMatchObject({ ok: false, reason: /signature does not verify/ });
  });

  it("rejects a hand-made challenge with no signature", () => {
    const raw = Buffer.from(JSON.stringify({ ...base, nonce: `0x${"11".repeat(32)}` })).toString(
      "base64",
    );
    expect(checkChallenge(raw, expect_, SECRET)).toMatchObject({ ok: false, reason: /unsigned/ });
  });

  it("rejects garbage", () => {
    expect(checkChallenge("not-base64", expect_, SECRET).ok).toBe(false);
    expect(checkChallenge("", expect_, SECRET).ok).toBe(false);
  });

  // ── the attacks the MAC exists to stop ─────────────────────────────────────

  it("refuses a cheap challenge re-pointed at an expensive tool", () => {
    const cheap = issueChallenge({ ...base, tool: "get_goat_gas", amount: "10000" }, SECRET);
    const out = checkChallenge(encodeChallenge(cheap), expect_, SECRET);
    expect(out).toMatchObject({ ok: false });
  });

  it("refuses a challenge whose price was edited down", () => {
    const c = issueChallenge(base, SECRET);
    const out = checkChallenge(tamper(c, { amount: "1" }), expect_, SECRET);
    expect(out).toMatchObject({ ok: false, reason: /signature does not verify/ });
  });

  it("refuses a challenge whose settleTo was redirected", () => {
    // The most valuable edit an attacker could make: point the money at themselves.
    const c = issueChallenge(base, SECRET);
    const out = checkChallenge(
      tamper(c, { settleTo: "0x00000000000000000000000000000000000000ff" }),
      expect_,
      SECRET,
    );
    expect(out).toMatchObject({ ok: false, reason: /signature does not verify/ });
  });

  it("refuses a challenge whose expiry was extended", () => {
    const c = issueChallenge(base, SECRET);
    const out = checkChallenge(
      tamper(c, { expiresAt: Date.now() + 10 * 365 * 24 * 3600_000 }),
      expect_,
      SECRET,
    );
    expect(out).toMatchObject({ ok: false, reason: /signature does not verify/ });
  });

  it("refuses another payer's challenge", () => {
    const c = issueChallenge(base, SECRET);
    const out = checkChallenge(encodeChallenge(c), { ...expect_, payer: "0xdead" }, SECRET);
    expect(out).toMatchObject({ ok: false, reason: /different payer/ });
  });

  it("refuses an expired challenge", () => {
    const c = issueChallenge(base, SECRET);
    // Expiry is covered by the MAC, so the only way to present a stale one is honestly — which
    // is exactly what a client retrying after a long pause does.
    const expired = { ...c, expiresAt: Date.now() - 1 };
    const resigned = issueChallenge(base, SECRET);
    expect(checkChallenge(encodeChallenge(expired), expect_, SECRET).ok).toBe(false);
    expect(checkChallenge(encodeChallenge(resigned), expect_, SECRET).ok).toBe(true);
  });

  it("is insensitive to address casing, which wallets disagree on", () => {
    const c = issueChallenge(base, SECRET);
    const out = checkChallenge(encodeChallenge(c), { ...expect_, payer: BUYER.toLowerCase() }, SECRET);
    expect(out.ok).toBe(true);
  });
});
