import { describe, it, expect } from "vitest";
import { keccak256, toHex, hashTypedData, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RECEIPT_TYPES,
  toolId,
  asBytes32,
  receiptStruct,
  createChallengeReceiptSigner,
} from "../src/receipts.js";
import { ReceiptSchema } from "@tiagoh/core";

/**
 * These tests guard the seam between the TypeScript client and the Solidity registry. A
 * co-signed receipt is only evidence if `ReceiptRegistry` recovers the same signers the client
 * intended — so if the EIP-712 type string, the domain, or the toolId derivation ever drift
 * apart, disputes silently stop working. That is exactly the kind of break a unit test on
 * either side alone would not catch.
 */

/** Byte-for-byte the string hashed into `ReceiptRegistry.RECEIPT_TYPEHASH`. */
const SOLIDITY_TYPE_STRING =
  "Receipt(bytes32 receiptId,bytes32 parentId,address payer,address payee,address token,uint256 amount,bytes32 toolId)";

const DOMAIN = {
  name: "tiagoh ReceiptRegistry",
  version: "1",
  chainId: 2345,
  verifyingContract: "0x87c8D46366918C848012Ad048cEba32f11645042",
} as const;

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const account = privateKeyToAccount(PK);

const message = {
  receiptId: `0x${"11".repeat(32)}`,
  parentId: `0x${"00".repeat(32)}`,
  payer: account.address,
  payee: "0x0000000000000000000000000000000000005e11",
  token: "0xFd7315139eB2A77C7E87222F54c9711C7921f5Bc",
  amount: 20_000n,
  toolId: toolId("get_rwa_price"),
} as const;

describe("EIP-712 type agreement with the registry", () => {
  it("encodes exactly the type string the contract hashes", () => {
    const fields = RECEIPT_TYPES.Receipt.map((f) => `${f.type} ${f.name}`).join(",");
    expect(`Receipt(${fields})`).toBe(SOLIDITY_TYPE_STRING);
  });

  it("field order matches the contract's abi.encode order", () => {
    expect(RECEIPT_TYPES.Receipt.map((f) => f.name)).toEqual([
      "receiptId",
      "parentId",
      "payer",
      "payee",
      "token",
      "amount",
      "toolId",
    ]);
  });
});

describe("signature round-trip", () => {
  it("recovers the signer the contract's SignatureChecker would recover", async () => {
    const signature = await account.signTypedData({
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message,
    });

    expect(
      await verifyTypedData({
        address: account.address,
        domain: DOMAIN,
        types: RECEIPT_TYPES,
        primaryType: "Receipt",
        message,
        signature,
      }),
    ).toBe(true);
  });

  it("does not verify against a different chain — the domain binds chainId", async () => {
    const signature = await account.signTypedData({
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message,
    });

    expect(
      await verifyTypedData({
        address: account.address,
        domain: { ...DOMAIN, chainId: 48816 },
        types: RECEIPT_TYPES,
        primaryType: "Receipt",
        message,
        signature,
      }),
    ).toBe(false);
  });

  it("does not verify against a different registry deployment", async () => {
    const signature = await account.signTypedData({
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message,
    });

    expect(
      await verifyTypedData({
        address: account.address,
        domain: {
          ...DOMAIN,
          verifyingContract: "0x0000000000000000000000000000000000000001",
        },
        types: RECEIPT_TYPES,
        primaryType: "Receipt",
        message,
        signature,
      }),
    ).toBe(false);
  });

  it("does not verify once the amount is tampered with", async () => {
    const signature = await account.signTypedData({
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message,
    });

    expect(
      await verifyTypedData({
        address: account.address,
        domain: DOMAIN,
        types: RECEIPT_TYPES,
        primaryType: "Receipt",
        message: { ...message, amount: 20_001n },
        signature,
      }),
    ).toBe(false);
  });

  it("produces a stable digest for identical input", () => {
    const a = hashTypedData({ domain: DOMAIN, types: RECEIPT_TYPES, primaryType: "Receipt", message });
    const b = hashTypedData({ domain: DOMAIN, types: RECEIPT_TYPES, primaryType: "Receipt", message });
    expect(a).toBe(b);
  });
});

describe("toolId", () => {
  it("is keccak256 of the tool name — the EVM-native derivation bonds are keyed on", () => {
    expect(toolId("get_rwa_price")).toBe(keccak256(toHex("get_rwa_price")));
  });

  it("distinguishes tools", () => {
    expect(toolId("a")).not.toBe(toolId("b"));
  });
});

describe("asBytes32", () => {
  it("passes a 32-byte hex id through untouched", () => {
    const id = `0x${"ab".repeat(32)}`;
    expect(asBytes32(id)).toBe(id);
  });

  it("hashes anything that is not already bytes32", () => {
    expect(asBytes32("payment-1")).toBe(keccak256(toHex("payment-1")));
  });

  it("maps null/undefined to the zero word (no cascade parent)", () => {
    expect(asBytes32(null)).toBe(`0x${"00".repeat(32)}`);
    expect(asBytes32(undefined)).toBe(`0x${"00".repeat(32)}`);
  });
});

describe("receiptStruct", () => {
  it("carries the receipt's exact integer amount into the signed struct", () => {
    const receipt = ReceiptSchema.parse({
      paymentId: `0x${"11".repeat(32)}`,
      parentId: null,
      tool: "get_rwa_price",
      payer: account.address,
      payee: "0x0000000000000000000000000000000000005e11",
      amount: "20000",
      asset: "0xtUSD",
      status: "settled",
      createdAt: 1,
    });
    const struct = receiptStruct(receipt, "0xFd7315139eB2A77C7E87222F54c9711C7921f5Bc");
    expect(struct.amount).toBe(20_000n);
    expect(struct.toolId).toBe(toolId("get_rwa_price"));
    expect(struct.parentId).toBe(`0x${"00".repeat(32)}`);
  });
});

/**
 * Regression: cascade hops could never be co-signed.
 *
 * `createChallengeReceiptSigner` hardcoded `parentId` to zero, but the gateway writes the real
 * parent into the receipt it counter-signs. On any hop the two parties therefore signed different
 * structs, `anchorReceipt` rejected the pair, and — because the gateway treats a co-signing
 * failure as non-fatal — the call succeeded while quietly producing a receipt that could never
 * back a dispute. Every multi-hop payment, the feature the whole product is built around, was
 * evidence-free.
 */
describe("co-signing a cascade hop", () => {
  const TOKEN = "0xFd7315139eB2A77C7E87222F54c9711C7921f5Bc" as const;
  const SELLER = "0x0000000000000000000000000000000000005e11" as const;
  const PARENT = `0x${"22".repeat(32)}`;

  const hopChallenge = {
    receiptId: `0x${"11".repeat(32)}`,
    payTo: SELLER,
    tool: "get_rwa_price",
    amount: "20000",
    parentId: PARENT,
  };

  /** What the gateway counter-signs: the receipt as actually recorded, parent included. */
  const gatewayStruct = receiptStruct(
    ReceiptSchema.parse({
      paymentId: hopChallenge.receiptId,
      parentId: PARENT,
      tool: hopChallenge.tool,
      payer: account.address,
      payee: SELLER,
      amount: hopChallenge.amount,
      asset: "0xtUSD",
      status: "settled",
      createdAt: 1,
    }),
    TOKEN,
  );

  it("signs the hop's real parent, matching what the seller counter-signs", async () => {
    const sign = createChallengeReceiptSigner({
      privateKey: PK,
      registry: DOMAIN.verifyingContract,
      chainId: DOMAIN.chainId,
      payer: account.address,
      token: TOKEN,
    });
    const signature = await sign(hopChallenge);

    // The buyer's signature must verify against the *gateway's* struct, or the pair is worthless.
    const valid = await verifyTypedData({
      address: account.address,
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message: gatewayStruct,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("still signs a zero parent at the root of a cascade", async () => {
    const sign = createChallengeReceiptSigner({
      privateKey: PK,
      registry: DOMAIN.verifyingContract,
      chainId: DOMAIN.chainId,
      payer: account.address,
      token: TOKEN,
    });
    const signature = await sign({ ...hopChallenge, parentId: null });

    const valid = await verifyTypedData({
      address: account.address,
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message: { ...gatewayStruct, parentId: `0x${"00".repeat(32)}` },
      signature,
    });
    expect(valid).toBe(true);
  });

  it("does not verify against a struct with a different parent", async () => {
    const sign = createChallengeReceiptSigner({
      privateKey: PK,
      registry: DOMAIN.verifyingContract,
      chainId: DOMAIN.chainId,
      payer: account.address,
      token: TOKEN,
    });
    const signature = await sign(hopChallenge);

    const valid = await verifyTypedData({
      address: account.address,
      domain: DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message: { ...gatewayStruct, parentId: `0x${"33".repeat(32)}` },
      signature,
    });
    expect(valid).toBe(false);
  });
});
