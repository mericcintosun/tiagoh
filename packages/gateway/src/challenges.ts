import { TIAGOH, createNonce, type Bytes32Hex } from "@tiagoh/core";

/**
 * Challenge and idempotency store for the seller gateway.
 *
 * This is the piece that turns a 402 into a *single-use* offer. The gateway issues a nonce with
 * every challenge and remembers it; a paid retry must echo that nonce, and the nonce is retired
 * the moment a call settles against it.
 *
 * Why it matters: the flow is charge-on-success, so the tool runs *before* settlement can reject
 * a payment. Without a nonce, replaying one authorization extracted unlimited free executions —
 * each settle attempt failed, but the work had already been done. Pre-verification narrows that
 * window; it does not close it, because a facilitator cannot know an authorization is about to
 * be consumed by an in-flight transaction.
 *
 * The same store gives idempotency. A retried request (a dropped response, a proxy retry) finds
 * the completed result and returns it verbatim — the tool does not run twice and the buyer is
 * not billed twice. Concurrent retries share the in-flight promise for the same reason.
 *
 * The default implementation is in-memory, which is correct for a single gateway process. A
 * multi-instance deployment must supply a shared implementation (Redis, Postgres) — otherwise
 * each instance has its own nonce set and replay protection is only per-instance. That is a
 * deployment decision, so the interface is public.
 */
export interface IssuedChallenge {
  nonce: Bytes32Hex;
  tool: string;
  /** Minor units, base-10 integer string. */
  amount: string;
  payer: string;
  parentId: string | null;
  expiresAt: number;
}

export type ChallengeState<T> =
  | { status: "unknown" }
  | { status: "issued"; challenge: IssuedChallenge }
  | { status: "in_flight"; pending: Promise<T> }
  | { status: "settled"; result: T };

export interface ChallengeStore<T> {
  issue(challenge: IssuedChallenge): void | Promise<void>;
  get(nonce: string): ChallengeState<T> | Promise<ChallengeState<T>>;
  /** Marks a nonce as in flight. Returns false if it was already claimed (a replay). */
  claim(nonce: string, pending: Promise<T>): boolean | Promise<boolean>;
  complete(nonce: string, result: T): void | Promise<void>;
  /** Releases a claim so a failed attempt can be retried with the same challenge. */
  release(nonce: string): void | Promise<void>;
}

interface Entry<T> {
  challenge: IssuedChallenge;
  pending?: Promise<T>;
  result?: T;
  settled: boolean;
}

/** In-memory store with TTL eviction. Correct for one process; see the note above for clusters. */
export class InMemoryChallengeStore<T> implements ChallengeStore<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly retentionMs = 10 * 60_000) {}

  issue(challenge: IssuedChallenge): void {
    this.evictExpired();
    this.entries.set(challenge.nonce, { challenge, settled: false });
  }

  get(nonce: string): ChallengeState<T> {
    const entry = this.entries.get(nonce);
    if (!entry) return { status: "unknown" };
    if (entry.settled) return { status: "settled", result: entry.result as T };
    if (entry.pending) return { status: "in_flight", pending: entry.pending };
    if (Date.now() > entry.challenge.expiresAt) {
      this.entries.delete(nonce);
      return { status: "unknown" };
    }
    return { status: "issued", challenge: entry.challenge };
  }

  claim(nonce: string, pending: Promise<T>): boolean {
    const entry = this.entries.get(nonce);
    if (!entry || entry.settled || entry.pending) return false;
    entry.pending = pending;
    return true;
  }

  complete(nonce: string, result: T): void {
    const entry = this.entries.get(nonce);
    if (!entry) return;
    entry.pending = undefined;
    entry.result = result;
    entry.settled = true;
    // Keep the settled entry around so retries stay idempotent, then let it age out.
    entry.challenge.expiresAt = Date.now() + this.retentionMs;
  }

  release(nonce: string): void {
    const entry = this.entries.get(nonce);
    if (entry) entry.pending = undefined;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [nonce, entry] of this.entries) {
      if (!entry.pending && now > entry.challenge.expiresAt) this.entries.delete(nonce);
    }
  }
}

/** Issues a fresh, unguessable challenge nonce with the configured TTL. */
export function newChallenge(input: {
  tool: string;
  amount: string;
  payer: string;
  parentId: string | null;
  ttlMs?: number;
}): IssuedChallenge {
  return {
    nonce: createNonce(),
    tool: input.tool,
    amount: input.amount,
    payer: input.payer,
    parentId: input.parentId,
    expiresAt: Date.now() + (input.ttlMs ?? TIAGOH.DEFAULT_CHALLENGE_TTL_MS),
  };
}
