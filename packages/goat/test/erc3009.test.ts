import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Address, type PublicClient } from "viem";

import {
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  createErc3009Payer,
  createErc3009Verify,
  decodePaymentPayload,
  encodePaymentPayload,
  primeTokenDomain,
  resolveTokenDomain,
  type PaymentPayload,
} from "../src/erc3009.js";

/**
 * The payment layer that lets a stranger pay. These tests cover the two things that make it
 * either work or fail silently: the EIP-712 domain (a domain wrong by one character produces
 * signatures that verify nowhere, with no useful error) and the binding between the 402 challenge
 * and the authorization (which is what stops one signature from paying for a different call).
 *
 * The live-chain test at the bottom is the one that proves the domain is right against the real
 * token. It is opt-in so CI stays offline.
 */

const TOKEN = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8" as Address;
const SETTLER = "0x1111111111111111111111111111111111111111" as Address;
const CHAIN_ID = 2345;

// The domain verified against GOAT mainnet on 2026-08-09: hashing this reproduces the token's
// own DOMAIN_SEPARATOR (0x7ce5afae…) exactly.
const DOMAIN = {
  name: "Bridged USDC (Stargate)",
  version: "2",
  chainId: CHAIN_ID,
  verifyingContract: TOKEN,
} as const;

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const buyer = privateKeyToAccount(BUYER_KEY);

function challenge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    amount: "20000",
    asset: TOKEN,
    network: `eip155:${CHAIN_ID}`,
    settleTo: SETTLER,
    nonce: `0x${"ab".repeat(32)}`,
    expiresAt: Date.now() + 120_000,
    ...overrides,
  } as {
    amount: string;
    asset: string;
    network: string;
    settleTo: string;
    nonce: string;
    expiresAt: number;
  };
}

function payer() {
  return createErc3009Payer({
    privateKey: BUYER_KEY,
    token: TOKEN,
    chainId: CHAIN_ID,
    tokenDomain: { name: DOMAIN.name, version: DOMAIN.version },
  });
}

/** A public client stub: only the two methods this layer actually calls. */
function stubClient(over: {
  simulate?: () => Promise<unknown>;
  read?: (fn: string) => Promise<unknown>;
  chainId?: number;
}): PublicClient {
  return {
    getChainId: async () => over.chainId ?? CHAIN_ID,
    simulateContract: over.simulate ?? (async () => ({ result: undefined })),
    readContract: async ({ functionName }: { functionName: string }) =>
      over.read ? over.read(functionName) : undefined,
  } as unknown as PublicClient;
}

beforeEach(() => {
  primeTokenDomain(TOKEN, CHAIN_ID, { ...DOMAIN });
});

describe("the X-PAYMENT envelope", () => {
  const sample: PaymentPayload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:2345",
      amount: "20000",
      asset: TOKEN,
      payTo: SETTLER,
      extra: { assetTransferMethod: "eip3009", name: DOMAIN.name, version: "2" },
    },
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: buyer.address,
        to: SETTLER,
        value: "20000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"ab".repeat(32)}`,
      },
    },
  };

  it("round-trips through base64", () => {
    expect(decodePaymentPayload(encodePaymentPayload(sample))).toEqual(sample);
  });

  it("also accepts raw JSON, so a human can debug with curl", () => {
    expect(decodePaymentPayload(JSON.stringify(sample))).toEqual(sample);
  });

  it("returns null rather than throwing on junk", () => {
    // An undecodable header is a failed payment, not a server error: the gateway answers it
    // with a fresh 402 instead of a 500.
    expect(decodePaymentPayload("not-base64-or-json")).toBeNull();
    expect(decodePaymentPayload("")).toBeNull();
    expect(decodePaymentPayload(Buffer.from("{}").toString("base64"))).toBeNull();
  });
});

describe("the buyer's signature", () => {
  it("recovers to the buyer, over the token's real EIP-712 domain", async () => {
    const c = challenge();
    const decoded = decodePaymentPayload(await payer().sign(c))!;
    const a = decoded.payload.authorization;

    const recovered = await recoverTypedDataAddress({
      domain: DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: a.from,
        to: a.to,
        value: BigInt(a.value),
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce,
      },
      signature: decoded.payload.signature,
    });
    expect(recovered.toLowerCase()).toBe(buyer.address.toLowerCase());
  });

  it("reuses the challenge nonce as the authorization nonce", async () => {
    // This is what makes the token itself the replay guard: the same nonce cannot buy twice,
    // enforced by `authorizationState` rather than by the gateway's memory.
    const c = challenge();
    const decoded = decodePaymentPayload(await payer().sign(c))!;
    expect(decoded.payload.authorization.nonce).toBe(c.nonce);
  });

  it("pays the settler, not the seller, when one is configured", async () => {
    const decoded = decodePaymentPayload(await payer().sign(challenge()))!;
    expect(decoded.payload.authorization.to).toBe(SETTLER);
  });

  it("expires with the challenge", async () => {
    const c = challenge();
    const decoded = decodePaymentPayload(await payer().sign(c))!;
    expect(decoded.payload.authorization.validBefore).toBe(
      String(Math.floor(c.expiresAt / 1000)),
    );
  });

  it("backdates validAfter, because FiatTokenV2 compares it exclusively", async () => {
    // `block.timestamp > validAfter` means an authorization stamped "now" is rejected in the
    // same second it was signed.
    const decoded = decodePaymentPayload(await payer().sign(challenge()))!;
    expect(Number(decoded.payload.authorization.validAfter)).toBeLessThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it("advertises eip3009 and the domain it signed under", async () => {
    const decoded = decodePaymentPayload(await payer().sign(challenge()))!;
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.scheme).toBe("exact");
    expect(decoded.accepted.extra).toEqual({
      assetTransferMethod: "eip3009",
      name: DOMAIN.name,
      version: "2",
    });
  });

  it("signs a different digest for a different price", async () => {
    const a = decodePaymentPayload(await payer().sign(challenge()))!;
    const b = decodePaymentPayload(await payer().sign(challenge({ amount: "20001" })))!;
    expect(a.payload.signature).not.toBe(b.payload.signature);
  });
});

describe("verification binds every field of the challenge", () => {
  const verify = () =>
    createErc3009Verify({
      token: TOKEN,
      settleTo: SETTLER,
      publicClient: stubClient({}),
    });

  const verifiable = (over: Partial<Record<string, string>> = {}) => ({
    amount: "20000",
    nonce: `0x${"ab".repeat(32)}`,
    payer: buyer.address,
    settleTo: SETTLER,
    ...over,
  });

  it("accepts a well-formed, settleable authorization", async () => {
    const header = await payer().sign(challenge());
    const result = await verify()(header, verifiable());
    expect(result.ok).toBe(true);
    expect(result.authorization?.from.toLowerCase()).toBe(buyer.address.toLowerCase());
  });

  it("rejects a payload it cannot decode", async () => {
    const result = await verify()("garbage", verifiable());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/decodable/);
  });

  it("rejects an authorization signed by someone other than the challenged payer", async () => {
    const header = await payer().sign(challenge());
    const result = await verify()(header, verifiable({ payer: "0x00000000000000000000000000000000000000ff" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not the challenged payer/);
  });

  it("rejects an authorization that pays somewhere else", async () => {
    // Signed to pay a different address than the gateway asked for — the money would land
    // outside the settler and the split would hand out tokens it never received.
    const header = await payer().sign(challenge({ settleTo: "0x00000000000000000000000000000000000000dd" }));
    const result = await verify()(header, verifiable());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/authorization pays/);
  });

  it("rejects an underpayment", async () => {
    const header = await payer().sign(challenge({ amount: "1" }));
    const result = await verify()(header, verifiable());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/price is 20000/);
  });

  it("rejects a signature issued for a different challenge", async () => {
    // The nonce binding is what stops a valid authorization from being spent on another call.
    const header = await payer().sign(challenge({ nonce: `0x${"cd".repeat(32)}` }));
    const result = await verify()(header, verifiable());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/nonce does not match/);
  });

  it("rejects an expired authorization", async () => {
    const header = await payer().sign(challenge({ expiresAt: Date.now() - 60_000 }));
    const result = await verify()(header, verifiable());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it("rejects when simulation says the transfer cannot settle", async () => {
    // Structurally perfect but unpayable — an empty balance, or a nonce already spent. This is
    // the check that stops the gateway doing work it will not be paid for.
    const failing = createErc3009Verify({
      token: TOKEN,
      settleTo: SETTLER,
      publicClient: stubClient({
        simulate: async () => {
          throw new Error("ERC20: transfer amount exceeds balance");
        },
      }),
    });
    const result = await failing(await payer().sign(challenge()), verifiable());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not settleable.*exceeds balance/);
  });
});

describe("token domain resolution", () => {
  it("reads name and version from the token rather than assuming them", async () => {
    const other = "0x2222222222222222222222222222222222222222" as Address;
    const domain = await resolveTokenDomain(other, {
      chainId: CHAIN_ID,
      publicClient: stubClient({
        read: async (fn) => (fn === "name" ? "Bridged stgUSDT" : "1"),
      }),
    });
    expect(domain).toEqual({
      name: "Bridged stgUSDT",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: other,
    });
  });

  it("falls back to version 2 when the token does not expose version()", async () => {
    const other = "0x3333333333333333333333333333333333333333" as Address;
    const domain = await resolveTokenDomain(other, {
      chainId: CHAIN_ID,
      publicClient: stubClient({
        read: async (fn) => {
          if (fn === "version") throw new Error("no such function");
          return "Token";
        },
      }),
    });
    expect(domain.version).toBe("2");
  });

  it("refuses to sign against a chain id the RPC disagrees with", async () => {
    // The chain id is part of the EIP-712 domain, so a mismatch does not fail — it produces a
    // valid signature for the wrong chain, and the token then reverts with "invalid signature",
    // which points the reader at the signer instead of at their config. A stale
    // `GOAT_CHAIN_ID=48816` left over from testnet is enough to cause it.
    const other = "0x5555555555555555555555555555555555555555" as Address;
    await expect(
      resolveTokenDomain(other, {
        chainId: 48816, // Testnet3
        publicClient: stubClient({ chainId: 2345, read: async () => "Token" }), // …but this is mainnet
      }),
    ).rejects.toThrow(/chain id mismatch: configured 48816 but the RPC reports 2345/);
  });

  it("caches, so signing does not hit the chain on every call", async () => {
    const other = "0x4444444444444444444444444444444444444444" as Address;
    let reads = 0;
    const client = stubClient({
      read: async (fn) => {
        reads++;
        return fn === "name" ? "Cached" : "2";
      },
    });
    await resolveTokenDomain(other, { chainId: CHAIN_ID, publicClient: client });
    const before = reads;
    await resolveTokenDomain(other, { chainId: CHAIN_ID, publicClient: client });
    expect(reads).toBe(before);
  });
});

/**
 * The proof that the whole scheme is correct against the real token, without spending anything.
 *
 * An unfunded throwaway key signs a genuine authorization and it is simulated against live
 * USDC.e on GOAT mainnet. If the domain, the type hash or the encoding were wrong the token
 * would answer "invalid signature"; because they are right, it gets all the way to the balance
 * check and answers "transfer amount exceeds balance". That distinction is the assertion.
 *
 * Opt in with TIAGOH_LIVE_RPC=1.
 */
describe.skipIf(process.env.TIAGOH_LIVE_RPC !== "1")("live GOAT mainnet", () => {
  it("produces an authorization real USDC.e accepts as validly signed", async () => {
    const throwaway = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const { createPublicClient, http } = await import("viem");
    const client = createPublicClient({
      transport: http(process.env.GOAT_RPC_URL ?? "https://rpc.goat.network"),
    });

    const domain = await resolveTokenDomain(TOKEN, { chainId: CHAIN_ID, publicClient: client });
    expect(domain.name).toBe("Bridged USDC (Stargate)");
    expect(domain.version).toBe("2");

    const live = createErc3009Payer({
      privateKey: BUYER_KEY,
      token: TOKEN,
      chainId: CHAIN_ID,
      publicClient: client,
    });
    const header = await live.sign(challenge({ settleTo: throwaway.address }));

    const result = await createErc3009Verify({
      token: TOKEN,
      settleTo: throwaway.address,
      publicClient: client,
    })(header, {
      amount: "20000",
      nonce: `0x${"ab".repeat(32)}`,
      payer: throwaway.address,
      settleTo: throwaway.address,
    });

    // Rejected for having no money — NOT for a bad signature. That is the whole point.
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds balance/);
    expect(result.reason).not.toMatch(/invalid signature/i);
  }, 30_000);
});
