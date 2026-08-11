import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A stateless x402 paywall for the hosted MCP endpoint.
 *
 * The endpoint runs on serverless, where every request may hit a different instance, so the
 * gateway's in-memory challenge store would give each instance its own nonce set — replay
 * protection that only works if you are lucky with routing. The usual fix is Redis. It is not
 * needed here, and the reason is worth stating because it inverts the usual trade-off:
 *
 *   **The payment token is the nonce registry.** The buyer's ERC-3009 authorization carries the
 *   challenge nonce, and USDC.e records it in `authorizationState` the moment it settles. So
 *   "has this challenge already been paid?" is a question the chain answers, globally and
 *   atomically, for every instance at once. Replaying a spent authorization fails at the
 *   *verify* step — which runs before the tool does — so it never even reaches execution.
 *
 * That leaves one thing genuinely needing state: proving the gateway itself issued a challenge.
 * Instead of remembering issued challenges, we sign them. A challenge is an HMAC-authenticated
 * envelope; on the paid retry the gateway re-checks its own signature. Unforgeable, expiring,
 * and completely instance-independent.
 *
 * Residual, and deliberately accepted: two *concurrent* requests carrying the same fresh
 * authorization can both pass verification and both execute before either settles. One of them
 * then fails to settle. The cost is one extra execution of a read-only tool — an RPC call, not
 * money — and no double charge is possible. A shared store would close that window; for priced
 * chain reads it is not worth the dependency.
 */

/** Minutes a challenge stays payable. Also the ERC-3009 authorization's `validBefore`. */
const TTL_MS = 120_000;

export interface Challenge {
  tool: string;
  /** Exact minor units of the asset, base-10 string. */
  amount: string;
  asset: string;
  assetDecimals: number;
  network: string;
  /** The seller identity named on the receipt. */
  payTo: string;
  /** Where the authorization actually sends the money (settler, or payTo). */
  settleTo: string;
  payer: string;
  nonce: string;
  parentId: string | null;
  expiresAt: number;
  accepts: Array<{
    scheme: "exact";
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: { assetTransferMethod: "eip3009" };
  }>;
}

/** The challenge plus the gateway's own signature over it. */
export interface SignedChallenge extends Challenge {
  sig: string;
}

/**
 * Canonical serialization for the MAC. Explicit field order rather than `JSON.stringify` of the
 * object, so a key-order change in a refactor cannot silently invalidate every live challenge —
 * or, worse, make two different challenges hash the same.
 */
function preimage(c: Challenge): string {
  return [
    "tiagoh:challenge:v1",
    c.tool,
    c.amount,
    c.asset.toLowerCase(),
    String(c.assetDecimals),
    c.network,
    c.payTo.toLowerCase(),
    c.settleTo.toLowerCase(),
    c.payer.toLowerCase(),
    c.nonce.toLowerCase(),
    c.parentId ?? "",
    String(c.expiresAt),
  ].join("\n");
}

function sign(c: Challenge, secret: string): string {
  return createHmac("sha256", secret).update(preimage(c), "utf8").digest("hex");
}

export function issueChallenge(
  input: Omit<Challenge, "nonce" | "expiresAt" | "accepts">,
  secret: string,
): SignedChallenge {
  const expiresAt = Date.now() + TTL_MS;
  const challenge: Challenge = {
    ...input,
    // Random, not derived: two calls for the same tool by the same payer must not collide on a
    // nonce, or the second could never settle.
    nonce: `0x${randomBytes(32).toString("hex")}`,
    expiresAt,
    accepts: [
      {
        scheme: "exact",
        network: input.network,
        amount: input.amount,
        asset: input.asset,
        payTo: input.settleTo,
        maxTimeoutSeconds: Math.round(TTL_MS / 1000),
        extra: { assetTransferMethod: "eip3009" },
      },
    ],
  };
  return { ...challenge, sig: sign(challenge, secret) };
}

export type ChallengeCheck =
  | { ok: true; challenge: Challenge }
  | { ok: false; reason: string };

/**
 * Re-authenticate a challenge the client echoed back, and bind it to the call being made.
 *
 * The binding matters as much as the signature: without it a valid, cheap challenge could be
 * presented against an expensive tool.
 */
export function checkChallenge(
  raw: string,
  expect: { tool: string; amount: string; payer: string },
  secret: string,
): ChallengeCheck {
  let parsed: SignedChallenge;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as SignedChallenge;
  } catch {
    return { ok: false, reason: "challenge is not decodable" };
  }
  if (!parsed?.sig || typeof parsed.sig !== "string") {
    return { ok: false, reason: "challenge is unsigned" };
  }

  const { sig, ...challenge } = parsed;
  const expected = sign(challenge as Challenge, secret);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "challenge signature does not verify" };
  }

  if (Date.now() > challenge.expiresAt) return { ok: false, reason: "challenge expired" };
  if (challenge.tool !== expect.tool) {
    return { ok: false, reason: `challenge was issued for ${challenge.tool}` };
  }
  if (challenge.amount !== expect.amount) {
    return { ok: false, reason: "challenge amount does not match the tool price" };
  }
  if (challenge.payer.toLowerCase() !== expect.payer.toLowerCase()) {
    return { ok: false, reason: "challenge was issued to a different payer" };
  }
  return { ok: true, challenge: challenge as Challenge };
}

export function encodeChallenge(c: SignedChallenge): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64");
}
