/**
 * ERC-3009 settlement — the canonical x402 v2 `exact` scheme, self-facilitated.
 *
 * This is what makes tiagoh payable by a stranger. Before it, the only working settle path held
 * the buyer's private key inside the gateway process and moved the money itself, which meant the
 * buyer and the seller were the same program: real tokens moved, but no third party could ever
 * pay. Everything else — discovery, pricing, reputation, bonds — was downstream of a door that
 * did not open.
 *
 * The door opens because GOAT mainnet's USDC.e turns out to be a genuine Circle **FiatTokenV2**.
 * Verified on-chain 2026-08-09: `transferWithAuthorization`, `receiveWithAuthorization`,
 * `cancelAuthorization`, `permit` and `authorizationState` are all present, and the EIP-712 domain
 * `{name: "Bridged USDC (Stargate)", version: "2", chainId: 2345, verifyingContract: 0x3022b87a…}`
 * reproduces the token's own `DOMAIN_SEPARATOR` exactly. So the standard x402 `exact` flow works
 * natively here and no facilitator is required — the gateway *is* the facilitator.
 *
 * Three properties follow, and each one is load-bearing:
 *
 *   1. **The buyer needs no native gas.** They sign; whoever relays pays the (near-zero) fee. A
 *      wallet holding nothing but USDC.e can buy a tool call.
 *   2. **Replay protection moves into the token.** The gateway's challenge nonce is used verbatim
 *      as the ERC-3009 authorization nonce, so `authorizationState` is the guard. That is strictly
 *      stronger than the gateway's in-memory nonce set, which only ever protected one process
 *      (SECURITY.md §5).
 *   3. **`verify` becomes real.** Simulating the transfer with `eth_call` answers exactly the
 *      question a facilitator's `/verify` answers — is this authorization valid and settleable
 *      right now — with no trusted third party and no `allowUnverifiedPayments`.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  parseAbiItem,
  parseSignature,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Receipt } from "@tiagoh/core";
import { goatPublicClient, goatWalletClient } from "./clients.js";
import { withBuilderCode } from "./direct-settle.js";
import { asBytes32, receiptStruct, toolId, type ReceiptStruct } from "./receipts.js";

// ── the signed authorization ─────────────────────────────────────────────────

/** The EIP-712 type, byte-for-byte what FiatTokenV2 hashes. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** `payload.authorization` in the x402 `exact` scheme. Amounts are base-10 strings on the wire. */
export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/** The EIP-712 domain of an ERC-3009 token. `name`/`version` come from the token itself. */
export interface TokenDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** The base64 `X-PAYMENT` envelope, shaped as the x402 v2 `exact` scheme defines it. */
export interface PaymentPayload {
  x402Version: 2;
  accepted: {
    scheme: "exact";
    network: string;
    amount: string;
    asset: Address;
    payTo: Address;
    extra: { assetTransferMethod: "eip3009"; name: string; version: string };
  };
  payload: { signature: Hex; authorization: Authorization };
}

const ERC3009_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "event",
    name: "AuthorizationUsed",
    inputs: [
      { name: "authorizer", type: "address", indexed: true },
      { name: "nonce", type: "bytes32", indexed: true },
    ],
  },
] as const;

const SETTLER_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "auth",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "receiptId", type: "bytes32" },
          { name: "parentId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "payee", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "toolId", type: "bytes32" },
        ],
      },
      { name: "payerSignature", type: "bytes" },
      { name: "payeeSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleBare",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "auth",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "receiptId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "toolId", type: "bytes32" },
      { name: "payee", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [
      { name: "fee", type: "uint256" },
      { name: "net", type: "uint256" },
    ],
  },
] as const;

const ANCHOR_ABI = [
  {
    type: "function",
    name: "anchorReceipt",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "receiptId", type: "bytes32" },
          { name: "parentId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "payee", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "toolId", type: "bytes32" },
        ],
      },
      { name: "payerSignature", type: "bytes" },
      { name: "payeeSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordReceipt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiptId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "toolId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

// ── token domain ─────────────────────────────────────────────────────────────

const domainCache = new Map<string, TokenDomain>();

/**
 * Read a token's EIP-712 domain from the token itself.
 *
 * Hardcoding it would be a trap: the domain name is the token's `name()`, which is
 * `"Bridged USDC (Stargate)"` here and something else on every other deployment, and a domain
 * that is wrong by one character produces signatures that fail with no useful error. Reading it
 * means the same code works for USDT, for a testnet token, or for whatever the chain bridges next.
 */
export async function resolveTokenDomain(
  token: Address,
  opts: { chainId: number; rpcUrl?: string; publicClient?: PublicClient; override?: Partial<TokenDomain> },
): Promise<TokenDomain> {
  const key = `${opts.chainId}:${token.toLowerCase()}`;
  const cached = domainCache.get(key);
  if (cached && !opts.override) return cached;

  const client = opts.publicClient ?? goatPublicClient({ rpcUrl: opts.rpcUrl });

  // Fail loudly if the configured chain id does not match the chain we are actually talking to.
  //
  // The chain id is part of the EIP-712 domain, so getting it wrong does not produce an error —
  // it produces a *valid signature for a different chain*. The token then recovers some other
  // address and reverts with "invalid signature", which reads like a broken signer and sends you
  // looking in entirely the wrong place. A stale `GOAT_CHAIN_ID=48816` in an env file left over
  // from testnet is enough to cause it, and that is exactly how this was found.
  const actual = await client.getChainId().catch(() => undefined);
  if (actual !== undefined && actual !== opts.chainId) {
    throw new Error(
      `chain id mismatch: configured ${opts.chainId} but the RPC reports ${actual}. ` +
        "The EIP-712 domain binds the chain id, so signatures made against the wrong one are " +
        "valid but unusable. Check GOAT_CHAIN_ID / GOAT_RPC_URL.",
    );
  }

  const [name, version] = await Promise.all([
    opts.override?.name
      ? Promise.resolve(opts.override.name)
      : client.readContract({ address: token, abi: ERC3009_ABI, functionName: "name" }),
    opts.override?.version
      ? Promise.resolve(opts.override.version)
      : client
          .readContract({ address: token, abi: ERC3009_ABI, functionName: "version" })
          // Not every ERC-3009 token exposes `version()`; FiatTokenV2 does, and "2" is its value.
          .catch(() => "2"),
  ]);

  const domain: TokenDomain = {
    name: String(name),
    version: String(version),
    chainId: opts.chainId,
    verifyingContract: token,
  };
  domainCache.set(key, domain);
  return domain;
}

/** Test seam — drop a domain in without touching the network. */
export function primeTokenDomain(token: Address, chainId: number, domain: TokenDomain): void {
  domainCache.set(`${chainId}:${token.toLowerCase()}`, domain);
}

// ── the X-PAYMENT envelope ───────────────────────────────────────────────────

export function encodePaymentPayload(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64");
}

/**
 * Decode an `X-PAYMENT` header. Accepts base64 (what the spec says) or raw JSON (what a human
 * debugging with curl will send). Returns null rather than throwing: an undecodable header is a
 * failed payment, not a server error, and the caller answers it with a fresh 402.
 */
export function decodePaymentPayload(header: string): PaymentPayload | null {
  const raw = header.trim();
  const attempt = (text: string): PaymentPayload | null => {
    try {
      const parsed = JSON.parse(text) as PaymentPayload;
      return parsed?.payload?.authorization ? parsed : null;
    } catch {
      return null;
    }
  };
  if (raw.startsWith("{")) return attempt(raw);
  try {
    return attempt(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// ── buyer side ───────────────────────────────────────────────────────────────

/** The subset of a 402 challenge the payer needs. Structural, so the client stays decoupled. */
export interface PayableChallenge {
  amount: string;
  asset: string;
  network: string;
  /** Where the money goes — the settler contract, or the seller when settling directly. */
  settleTo: string;
  nonce: string;
  expiresAt: number;
}

export interface Erc3009PayerOptions {
  privateKey: Hex;
  token: Address;
  chainId: number;
  rpcUrl?: string;
  publicClient?: PublicClient;
  /** Skip the on-chain domain read (offline signing, or a token without `version()`). */
  tokenDomain?: Partial<TokenDomain>;
  /** Clock skew allowance, seconds. The authorization is valid from `now - skew`. */
  clockSkewSec?: number;
}

/**
 * Buyer-side signer for the gateway's `sign` hook.
 *
 * Signing needs no gas, no allowance, and (after the one-time domain read) no RPC. The challenge
 * nonce is reused verbatim as the authorization nonce, so this signature can only ever settle the
 * one call it was issued for — the token will refuse a second use.
 */
export function createErc3009Payer(opts: Erc3009PayerOptions) {
  const account = privateKeyToAccount(opts.privateKey);
  const skew = BigInt(opts.clockSkewSec ?? 60);

  return {
    address: account.address,
    async sign(challenge: PayableChallenge): Promise<string> {
      const domain = await resolveTokenDomain(opts.token, {
        chainId: opts.chainId,
        rpcUrl: opts.rpcUrl,
        publicClient: opts.publicClient,
        override: opts.tokenDomain,
      });

      const now = BigInt(Math.floor(Date.now() / 1000));
      // `validAfter` is exclusive in FiatTokenV2 (`block.timestamp > validAfter`), so backdating
      // also avoids a same-second rejection, not just clock skew between the two machines.
      const validAfter = now > skew ? now - skew : 0n;
      const validBefore = BigInt(Math.floor(challenge.expiresAt / 1000));

      const authorization: Authorization = {
        from: account.address,
        to: challenge.settleTo as Address,
        value: challenge.amount,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce: asBytes32(challenge.nonce),
      };

      const signature = await account.signTypedData({
        domain,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: authorization.from,
          to: authorization.to,
          value: BigInt(authorization.value),
          validAfter,
          validBefore,
          nonce: authorization.nonce,
        },
      });

      return encodePaymentPayload({
        x402Version: 2,
        accepted: {
          scheme: "exact",
          network: challenge.network,
          amount: challenge.amount,
          asset: challenge.asset as Address,
          payTo: challenge.settleTo as Address,
          extra: {
            assetTransferMethod: "eip3009",
            name: domain.name,
            version: domain.version,
          },
        },
        payload: { signature, authorization },
      });
    },
  };
}

// ── seller side: verify ──────────────────────────────────────────────────────

export interface Erc3009VerifyOptions {
  token: Address;
  /** The address the authorization must pay — the settler, or the seller in direct mode. */
  settleTo: Address;
  rpcUrl?: string;
  publicClient?: PublicClient;
  /** Address the simulation runs as. Any address works; `transferWithAuthorization` is open. */
  submitter?: Address;
}

/** What the gateway hands to `verifyPayment`, reduced to what verification actually needs. */
export interface VerifiableChallenge {
  amount: string;
  nonce: string;
  payer: string;
  settleTo: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  authorization?: Authorization;
  signature?: Hex;
}

/**
 * The real x402 `verify` step, run against the chain instead of a facilitator.
 *
 * Cheap structural checks first (they need no network and catch the common cases with a precise
 * reason), then `eth_call` the transfer. Simulation is authoritative for everything the structure
 * cannot see: the signature recovers to `from`, the nonce is unspent, the window is open, and the
 * balance is there.
 *
 * It is not a *guarantee* — the buyer could move funds between this call and settlement — but it
 * is exactly the guarantee a facilitator gives, and it is what lets the gateway refuse to do work
 * for an authorization that cannot pay.
 */
export function createErc3009Verify(opts: Erc3009VerifyOptions) {
  const client = opts.publicClient ?? goatPublicClient({ rpcUrl: opts.rpcUrl });

  return async function verify(
    header: string,
    challenge: VerifiableChallenge,
  ): Promise<VerifyResult> {
    const decoded = decodePaymentPayload(header);
    if (!decoded) return { ok: false, reason: "payment header is not a decodable x402 payload" };

    const { authorization: a, signature } = decoded.payload;
    const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

    if (!eq(a.from, challenge.payer)) {
      return { ok: false, reason: `authorization signer ${a.from} is not the challenged payer` };
    }
    if (!eq(a.to, challenge.settleTo)) {
      return { ok: false, reason: `authorization pays ${a.to}, expected ${challenge.settleTo}` };
    }
    if (a.value !== challenge.amount) {
      return { ok: false, reason: `authorization is for ${a.value}, price is ${challenge.amount}` };
    }
    // The authorization nonce IS the challenge nonce: that binding is what stops one signature
    // from being spent against a different call.
    if (!eq(a.nonce, asBytes32(challenge.nonce))) {
      return { ok: false, reason: "authorization nonce does not match the challenge" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (Number(a.validBefore) <= now) return { ok: false, reason: "authorization has expired" };
    if (Number(a.validAfter) >= now) return { ok: false, reason: "authorization is not yet valid" };

    let v: number;
    let r: Hex;
    let s: Hex;
    try {
      const parsed = parseSignature(signature);
      v = Number(parsed.v ?? (parsed.yParity === 0 ? 27n : 28n));
      r = parsed.r;
      s = parsed.s;
    } catch {
      return { ok: false, reason: "signature is malformed" };
    }

    try {
      await client.simulateContract({
        address: opts.token,
        abi: ERC3009_ABI,
        functionName: "transferWithAuthorization",
        args: [
          a.from,
          a.to,
          BigInt(a.value),
          BigInt(a.validAfter),
          BigInt(a.validBefore),
          a.nonce,
          v,
          r,
          s,
        ],
        account: opts.submitter ?? a.from,
      });
    } catch (err) {
      return { ok: false, reason: `authorization is not settleable: ${shortError(err)}` };
    }

    return { ok: true, authorization: a, signature };
  };
}

// ── seller side: settle ──────────────────────────────────────────────────────

export type SettleMode = "settler" | "direct";

export interface Erc3009SettleOptions {
  /** Key that submits the transaction. Needs gas, never holds the payment. */
  submitterPrivateKey: Hex;
  token: Address;
  receiptRegistry: Address;
  /** Required for `settler` mode: the X402Settler the authorization pays. */
  settler?: Address;
  mode?: SettleMode;
  rpcUrl?: string;
  /** wei; GOAT enforces a minimum priority fee (~130000). */
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
  /**
   * Called when a payment settled but its receipt failed to anchor. Only reachable in `direct`
   * mode, where the two are separate transactions — that combination leaves a paid call with no
   * on-chain record and no recourse, so it must be visible to the operator rather than swallowed.
   */
  onAnchorFailed?: (paymentId: string, reason: string) => void;
}

/**
 * The gateway's `SettleFn` arguments, narrowed to what settlement reads. Keeping the shape
 * structural (rather than importing `@tiagoh/gateway`) avoids a dependency cycle: the gateway
 * already depends on this package.
 */
export interface SettleArgs {
  /** The fully-formed, ideally co-signed receipt for this call. */
  receipt: Receipt;
  /** The `X-PAYMENT` header the buyer sent — the signed authorization lives inside it. */
  signature: string;
}

/**
 * Settle a verified x402 payment.
 *
 * `settler` mode is one transaction: the X402Settler pulls the authorization, takes the protocol
 * fee, pays the seller and anchors the co-signed receipt atomically. If either receipt signature
 * is wrong the whole thing reverts, so a settled payment always leaves evidence behind.
 *
 * `direct` mode is the no-contract fallback: transfer, then anchor separately. It is two
 * transactions and the two can diverge (a paid call whose receipt failed to anchor), which is
 * exactly why `settler` is the default.
 *
 * Transactions are serialized so concurrent cascade hops never race the submitter's nonce, and
 * both carry the ERC-8021 builder tag so tiagoh's traffic is filterable on-chain by anyone.
 */
export function createErc3009Settle(opts: Erc3009SettleOptions) {
  const mode = opts.mode ?? "settler";
  if (mode === "settler" && !opts.settler) {
    throw new Error("settler mode needs a settler address (or pass mode: 'direct')");
  }

  const wallet = goatWalletClient(opts.submitterPrivateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  const priority = opts.priorityGasPrice ?? 200_000n;
  const maxFee = opts.maxGasPrice ?? 1_000_000n;

  let queue: Promise<unknown> = Promise.resolve();

  const send = async (to: Address, data: Hex): Promise<Hex> => {
    const nonce = await pub.getTransactionCount({
      address: wallet.account.address,
      blockTag: "pending",
    });
    const hash = await wallet.sendTransaction({
      to,
      data: withBuilderCode(data),
      nonce,
      maxPriorityFeePerGas: priority,
      maxFeePerGas: maxFee,
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  };

  const run = async (args: SettleArgs): Promise<{ txHash?: string; payee: Address }> => {
    const payee = args.receipt.payee as Address;
    const decoded = decodePaymentPayload(args.signature);
    if (!decoded) throw new Error("settle called without a decodable payment payload");
    const { authorization: a, signature } = decoded.payload;
    const struct = receiptStruct(args.receipt, opts.token);

    try {
      if (mode === "settler") {
        const cosigned = Boolean(args.receipt.payerSignature && args.receipt.payeeSignature);
        // A standard x402 client signs the payment but knows nothing about tiagoh receipts, so
        // it cannot co-sign one. `settleBare` is the path for it: same atomic payment + fee +
        // receipt, but the receipt is RECORDER-level rather than dispute-grade. It is
        // operator-gated, because without the buyer's signature nothing else binds `payee`.
        const data = cosigned
          ? encodeFunctionData({
              abi: SETTLER_ABI,
              functionName: "settle",
              args: [
                authTuple(a),
                signature,
                struct,
                args.receipt.payerSignature as Hex,
                args.receipt.payeeSignature as Hex,
              ],
            })
          : encodeFunctionData({
              abi: SETTLER_ABI,
              functionName: "settleBare",
              args: [
                authTuple(a),
                signature,
                struct.receiptId,
                struct.parentId,
                struct.toolId,
                struct.payee,
              ],
            });
        return { txHash: await send(opts.settler as Address, data), payee };
      }

      // direct: the payment first, then the receipt. Charge-on-success already ran the tool, so
      // the payment is the step that must not be skipped.
      const { v, r, s } = splitSig(signature);
      const payHash = await send(
        opts.token,
        encodeFunctionData({
          abi: ERC3009_ABI,
          functionName: "transferWithAuthorization",
          args: [
            a.from,
            a.to,
            BigInt(a.value),
            BigInt(a.validAfter),
            BigInt(a.validBefore),
            a.nonce,
            v,
            r,
            s,
          ],
        }),
      );
      await anchor(send, opts.receiptRegistry, struct, args.receipt, opts.onAnchorFailed);
      return { txHash: payHash, payee };
    } catch (err) {
      // A spent nonce means the authorization already settled — front-run by another relayer, or
      // this is a retry. Either way the money reached `to`, because `to` and `value` are covered
      // by the buyer's signature and cannot have been altered. Reporting a failure here would
      // charge the buyer and withhold the result.
      const used = await pub
        .readContract({
          address: opts.token,
          abi: ERC3009_ABI,
          functionName: "authorizationState",
          args: [a.from, a.nonce],
        })
        .catch(() => false);
      if (used) {
        return { txHash: await findAuthorizationTx(pub, opts.token, a), payee };
      }
      throw err;
    }
  };

  return (args: SettleArgs): Promise<{ txHash?: string; payee: Address }> => {
    const p = queue.then(
      () => run(args),
      () => run(args),
    );
    queue = p.catch(() => {});
    return p;
  };
}

async function anchor(
  send: (to: Address, data: Hex) => Promise<Hex>,
  registry: Address,
  struct: ReceiptStruct,
  receipt: Receipt,
  onFailed?: (paymentId: string, reason: string) => void,
): Promise<void> {
  const cosigned = Boolean(receipt.payerSignature && receipt.payeeSignature);
  const data = cosigned
    ? encodeFunctionData({
        abi: ANCHOR_ABI,
        functionName: "anchorReceipt",
        args: [struct, receipt.payerSignature as Hex, receipt.payeeSignature as Hex],
      })
    : encodeFunctionData({
        abi: ANCHOR_ABI,
        functionName: "recordReceipt",
        args: [
          struct.receiptId,
          struct.parentId,
          struct.payer,
          struct.payee,
          struct.token,
          struct.amount,
          struct.toolId,
        ],
      });
  // The payment already happened, so a failed anchor must not be reported as a failed payment —
  // but it must not vanish either. In `direct` mode the transfer and the anchor are separate
  // transactions, so this is precisely the state where a paid call ends up with no on-chain
  // record and therefore no recourse for the buyer. `settler` mode does not have this failure
  // mode at all: there the anchor is part of the same transaction as the payment.
  await send(registry, data).catch((err: unknown) => {
    onFailed?.(receipt.paymentId, shortError(err));
  });
}

const AUTHORIZATION_USED_EVENT = parseAbiItem(
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
);

/** Locate the transaction that consumed an authorization, so a raced settle still reports a hash. */
async function findAuthorizationTx(
  pub: PublicClient,
  token: Address,
  a: Authorization,
): Promise<string | undefined> {
  try {
    const head = await pub.getBlockNumber();
    const logs = await pub.getLogs({
      address: token,
      event: AUTHORIZATION_USED_EVENT,
      args: { authorizer: a.from, nonce: a.nonce },
      // The authorization cannot be older than its own validity window, so a short lookback is
      // enough and keeps this from scanning the chain.
      fromBlock: head > 20_000n ? head - 20_000n : 0n,
      toBlock: "latest",
    });
    return logs[0]?.transactionHash ?? undefined;
  } catch {
    return undefined;
  }
}

function authTuple(a: Authorization) {
  return {
    from: a.from,
    to: a.to,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
  } as const;
}

function splitSig(signature: Hex): { v: number; r: Hex; s: Hex } {
  const parsed = parseSignature(signature);
  return {
    v: Number(parsed.v ?? (parsed.yParity === 0 ? 27n : 28n)),
    r: parsed.r,
    s: parsed.s,
  };
}

/**
 * Pull the actual revert reason out of a viem error.
 *
 * The reason is the whole diagnostic value here — "ERC20: transfer amount exceeds balance" and
 * "FiatTokenV2: authorization is used" send a buyer to completely different fixes. viem buries it
 * a couple of frames down and puts a generic sentence on the first line, so naively taking
 * `message.split("\n")[0]` throws away the only part worth reporting.
 */
function shortError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.data?.errorName ?? reverted.shortMessage;
    }
    return err.shortMessage.replace(/\s+/g, " ").slice(0, 200);
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 200);
}

/**
 * Adapter for the gateway's `verifyPayment` hook, which wants a plain boolean.
 *
 * The rejection reason is surfaced through `onReject` rather than thrown: the gateway answers a
 * failed verification with a fresh 402, and losing the reason makes an unpayable gateway
 * impossible to debug from the outside.
 */
export function createErc3009VerifyPayment(
  opts: Erc3009VerifyOptions & { onReject?: (reason: string) => void },
) {
  const verify = createErc3009Verify(opts);
  return async (args: {
    signature: string;
    amount: bigint;
    payer: string;
    nonce: string;
    challenge: { settleTo: string };
  }): Promise<boolean> => {
    const result = await verify(args.signature, {
      amount: args.amount.toString(),
      nonce: args.nonce,
      payer: args.payer,
      settleTo: args.challenge.settleTo,
    });
    if (!result.ok && result.reason) opts.onReject?.(result.reason);
    return result.ok;
  };
}

/** Ask the settler what a given gross amount splits into at the live fee. */
export async function quoteSettlement(
  settler: Address,
  amount: bigint,
  opts?: { rpcUrl?: string; publicClient?: PublicClient },
): Promise<{ fee: bigint; net: bigint }> {
  const client = opts?.publicClient ?? goatPublicClient({ rpcUrl: opts?.rpcUrl });
  const [fee, net] = await client.readContract({
    address: settler,
    abi: SETTLER_ABI,
    functionName: "quote",
    args: [amount],
  });
  return { fee, net };
}

export { toolId };
