import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  TIAGOH,
  deriveReceiptId,
  serializeMinor,
  toolPriceMinor,
  type Minor,
  type Receipt,
  type TiagohConfig,
} from "@tiagoh/core";
import { annotatePrices } from "./pricing.js";
import { buildDiscoveryDocument } from "./discovery.js";
import {
  InMemoryChallengeStore,
  newChallenge,
  type ChallengeStore,
  type IssuedChallenge,
} from "./challenges.js";

export type { IssuedChallenge };

/** The 402 body. Everything the buyer needs to pay, and to co-sign the resulting receipt. */
export interface PaymentChallenge {
  /** Minor units of `asset`, base-10 integer string. Never a float. */
  amount: string;
  asset: string;
  assetDecimals: number;
  /** CAIP-2 chain id, e.g. `eip155:2345` — the form the x402 v2 `exact` scheme uses. */
  network: string;
  /** The seller's identity: who the receipt names as payee, and who counter-signs it. */
  payTo: string;
  /**
   * Where the money is actually sent. This is the `X402Settler` when one is configured (it pulls
   * the authorization, takes the protocol fee and anchors the receipt in one transaction), and
   * `payTo` otherwise. It is separate from `payTo` because the address that *receives* a transfer
   * and the address that *signs* the receipt cannot be the same once a contract sits in between.
   */
  settleTo: string;
  tool: string;
  /** Single-use nonce; must be echoed on the paid retry. Also the ERC-3009 authorization nonce. */
  nonce: string;
  /** Deterministic id of the receipt this call will produce, so the buyer can pre-sign it. */
  receiptId: string;
  /**
   * Cascade parent of this call, or null at a root.
   *
   * It is in the challenge because the buyer signs the receipt *before* the seller does the work,
   * and the receipt struct includes `parentId`. Omitting it meant the buyer signed a struct with
   * a zero parent while the seller counter-signed one with the real parent, so the two signatures
   * covered different messages and `anchorReceipt` rejected every cascade hop.
   */
  parentId: string | null;
  expiresAt: number;
  /** x402 v2 payment requirements, so a standard x402 client can pay without knowing tiagoh. */
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

export type SettleFn = (args: {
  paymentId: string;
  tool: string;
  amount: Minor;
  payer: string;
  parentId: string | null;
  signature: string;
  nonce: string;
  /**
   * The fully-formed receipt this call produced, already counter-signed when the buyer pre-signed
   * it. Settlement needs it because the atomic path anchors the receipt in the same transaction
   * that moves the money — a payment and its evidence should not be able to disagree.
   */
  receipt: Receipt;
}) => Promise<{ txHash?: string; payee: string }>;

export type VerifyPaymentFn = (args: {
  tool: string;
  amount: Minor;
  asset: string;
  signature: string;
  payer: string;
  parentId: string | null;
  nonce: string;
  /** The challenge this payment claims to answer, so a verifier can bind every field. */
  challenge: PaymentChallenge;
}) => Promise<boolean>;

/** Counter-signs the receipt on the seller's behalf, producing dispute-grade evidence. */
export type CosignFn = (receipt: Receipt) => Promise<string>;

export type UpstreamCall = (
  tool: string,
  args: unknown,
  ctx: { paymentId: string; parentId: string | null },
) => Promise<unknown>;
export type UpstreamList = () => Promise<Array<{ name: string; description?: string }>>;

export interface GatewayOptions {
  config: TiagohConfig;
  /** Calls the wrapped upstream MCP tool. */
  callUpstream: UpstreamCall;
  /** Lists upstream tools (defaults to the priced tools in config). */
  listUpstream?: UpstreamList;
  /** Settles an x402 payment via the GOAT facilitator (see @tiagoh/goat). */
  settle: SettleFn;
  /**
   * Verifies the payment authorization BEFORE the upstream tool runs (the x402 verify step;
   * the facilitator's `/verify` on mainnet). An invalid or unverifiable signature is
   * re-challenged with a 402 instead of executing the tool, so the seller never does work
   * against a signature that cannot settle.
   *
   * REQUIRED unless `allowUnverifiedPayments` is set. It used to be optional and unset by
   * default, which meant the shipped default ran priced tools for anyone who sent any string
   * as a signature.
   */
  verifyPayment?: VerifyPaymentFn;
  /**
   * Escape hatch for local demos with a mock facilitator. Running a paid tool without
   * verifying the payment is giving work away, so this must be opted into explicitly and must
   * never be set in production.
   */
  allowUnverifiedPayments?: boolean;
  /**
   * Counter-signs each receipt. Together with the buyer's signature this produces a co-signed
   * receipt, which is the only kind `DisputeArbiter` accepts as proof of harm. Without it the
   * gateway still works, but its receipts are telemetry and its buyers have no recourse.
   */
  cosign?: CosignFn;
  /** Sink for settled receipts (e.g. a ReceiptRegistry anchor). */
  onReceipt?: (receipt: Receipt) => void;
  /** Replay/idempotency store. Supply a shared implementation when running more than one node. */
  challenges?: ChallengeStore<ToolCallResult>;
  /** How long a challenge stays payable. */
  challengeTtlMs?: number;
}

export type ToolCallResult =
  | { kind: "payment_required"; challenge: PaymentChallenge }
  | { kind: "ok"; result: unknown; receipt: Receipt };

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/**
 * The seller gateway. Prices each tool, answers an unpaid call with a single-use 402 challenge,
 * verifies the payment authorization before doing any work, and only settles if the upstream
 * tool *succeeds* (charge-on-success). A failed call is never billed.
 */
export class TiagohGateway {
  private readonly challenges: ChallengeStore<ToolCallResult>;

  constructor(private readonly opts: GatewayOptions) {
    this.challenges = opts.challenges ?? new InMemoryChallengeStore<ToolCallResult>();
    if (!opts.verifyPayment && !opts.allowUnverifiedPayments) {
      throw new GatewayError(
        "gateway refuses to serve priced tools without payment verification: pass `verifyPayment` " +
          "(see createFacilitatorVerify in @tiagoh/goat), or set `allowUnverifiedPayments: true` " +
          "for a local demo",
        500,
      );
    }
  }

  get config(): TiagohConfig {
    return this.opts.config;
  }

  /** Core per-call flow, transport-agnostic. */
  async handleToolCall(input: {
    tool: string;
    args: unknown;
    signature?: string;
    nonce?: string;
    receiptSignature?: string;
    payer?: string;
    parentId?: string | null;
  }): Promise<ToolCallResult> {
    const amount = toolPriceMinor(this.config, input.tool);
    const parentId = input.parentId ?? null;
    const payer = input.payer ?? "anon";

    // Free tool → run and return, no payment and no nonce accounting.
    if (amount === undefined || amount === 0n) {
      const paymentId = deriveReceiptId({
        payer,
        payee: this.config.payTo,
        tool: input.tool,
        amount: "0",
        nonce: `free:${Date.now()}:${Math.random()}`,
      });
      const result = await this.opts.callUpstream(input.tool, input.args, { paymentId, parentId });
      const receipt = this.receipt(paymentId, input.tool, 0n, payer, parentId, "settled");
      this.opts.onReceipt?.(receipt);
      return { kind: "ok", result, receipt };
    }

    // Unpaid → issue a fresh single-use challenge.
    if (!input.signature || !input.nonce) {
      return { kind: "payment_required", challenge: await this.issue(input.tool, amount, payer, parentId) };
    }

    // Replay / idempotency. A nonce we have already settled returns its stored result without
    // re-running the tool or re-charging; a nonce mid-flight shares that call's promise; an
    // unknown or expired nonce is re-challenged rather than trusted.
    const state = await this.challenges.get(input.nonce);
    if (state.status === "settled") return state.result;
    if (state.status === "in_flight") return state.pending;
    if (state.status === "unknown") {
      return { kind: "payment_required", challenge: await this.issue(input.tool, amount, payer, parentId) };
    }

    // The challenge must match the call it is being spent on: a nonce issued for a cheap tool
    // cannot be redirected at an expensive one, or spent by a different payer.
    const issued = state.challenge;
    if (
      issued.tool !== input.tool ||
      issued.amount !== serializeMinor(amount) ||
      issued.payer !== payer
    ) {
      return { kind: "payment_required", challenge: await this.issue(input.tool, amount, payer, parentId) };
    }

    // Verify the authorization BEFORE running anything.
    if (this.opts.verifyPayment) {
      let valid = false;
      try {
        valid = await this.opts.verifyPayment({
          tool: input.tool,
          amount,
          asset: this.config.asset,
          signature: input.signature,
          payer,
          parentId,
          nonce: input.nonce,
          challenge: this.toChallenge(issued),
        });
      } catch {
        valid = false;
      }
      if (!valid) {
        return { kind: "payment_required", challenge: await this.issue(input.tool, amount, payer, parentId) };
      }
    }

    // Reserve the nonce BEFORE touching the upstream tool. The reservation is a deferred
    // promise rather than the running call, because starting the work first would let two
    // concurrent retries of one challenge both execute — the exact double-execution the nonce
    // exists to prevent.
    let resolvePending!: (value: ToolCallResult) => void;
    let rejectPending!: (reason: unknown) => void;
    const pending = new Promise<ToolCallResult>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    // A second caller awaiting this promise still sees the rejection; this only stops Node
    // from reporting an unhandled rejection when nobody is waiting.
    void pending.catch(() => {});

    if (!(await this.challenges.claim(input.nonce, pending))) {
      rejectPending(new GatewayError("nonce already claimed", 409));
      const raced = await this.challenges.get(input.nonce);
      if (raced.status === "in_flight") return raced.pending;
      if (raced.status === "settled") return raced.result;
      return { kind: "payment_required", challenge: await this.issue(input.tool, amount, payer, parentId) };
    }

    try {
      const out = await this.execute({
        tool: input.tool,
        args: input.args,
        amount,
        payer,
        parentId,
        signature: input.signature,
        nonce: input.nonce,
        receiptSignature: input.receiptSignature,
      });
      resolvePending(out);
      await this.challenges.complete(input.nonce, out);
      return out;
    } catch (err) {
      // A failed attempt frees the nonce so the buyer may retry the same challenge — and,
      // because the tool errored, nothing was settled (charge-on-success).
      rejectPending(err);
      await this.challenges.release(input.nonce);
      throw err;
    }
  }

  /**
   * Run the tool, counter-sign the receipt, then settle. The order matters three times over:
   *
   *  - the tool runs first because it may cascade using this call's paymentId as the parent, and
   *    because a tool that throws must never be billed (charge-on-success);
   *  - the receipt is counter-signed *before* settlement, because the atomic settle path anchors
   *    it in the same transaction that moves the money. Signing afterwards would leave the
   *    payment and its evidence in separate transactions that can diverge;
   *  - settlement is last, so nothing is charged for work that did not happen.
   */
  private async execute(input: {
    tool: string;
    args: unknown;
    amount: Minor;
    payer: string;
    parentId: string | null;
    signature: string;
    nonce: string;
    receiptSignature?: string;
  }): Promise<ToolCallResult> {
    const paymentId = deriveReceiptId({
      payer: input.payer,
      payee: this.config.payTo,
      tool: input.tool,
      amount: serializeMinor(input.amount),
      nonce: input.nonce,
    });

    const result = await this.opts.callUpstream(input.tool, input.args, {
      paymentId,
      parentId: input.parentId,
    });

    let receipt = this.receipt(
      paymentId,
      input.tool,
      input.amount,
      input.payer,
      input.parentId,
      "settled",
      this.config.payTo,
      undefined,
      input.receiptSignature,
    );

    // Counter-sign so the receipt becomes evidence rather than the seller's own claim. A signing
    // failure must not fail the call — the buyer is about to get their result either way — but it
    // does mean this receipt cannot back a dispute, and an atomic settler will refuse to anchor
    // it, falling the deployment back to a telemetry-grade record.
    if (this.opts.cosign && input.receiptSignature) {
      try {
        receipt = { ...receipt, payeeSignature: await this.opts.cosign(receipt) };
      } catch {
        /* receipt stays telemetry-grade */
      }
    }

    const { txHash, payee } = await this.opts.settle({
      paymentId,
      tool: input.tool,
      amount: input.amount,
      payer: input.payer,
      parentId: input.parentId,
      signature: input.signature,
      nonce: input.nonce,
      receipt,
    });

    receipt = { ...receipt, txHash, payee };
    this.opts.onReceipt?.(receipt);
    return { kind: "ok", result, receipt };
  }

  private async issue(
    tool: string,
    amount: Minor,
    payer: string,
    parentId: string | null,
  ): Promise<PaymentChallenge> {
    const challenge = newChallenge({
      tool,
      amount: serializeMinor(amount),
      payer,
      parentId,
      ttlMs: this.opts.challengeTtlMs,
    });
    await this.challenges.issue(challenge);
    return this.toChallenge(challenge);
  }

  /**
   * Render a stored challenge as the wire object. Kept deterministic and separate from `issue`
   * so verification can reconstruct the exact challenge a payment claims to answer, rather than
   * trusting the fields the payer echoed back.
   */
  private toChallenge(issued: IssuedChallenge): PaymentChallenge {
    const network = `eip155:${this.config.chainId}`;
    const settleTo = this.config.settler ?? this.config.payTo;
    return {
      amount: issued.amount,
      asset: this.config.asset,
      assetDecimals: this.config.assetDecimals,
      network,
      payTo: this.config.payTo,
      settleTo,
      tool: issued.tool,
      nonce: issued.nonce,
      // Deterministic, so the buyer can sign the receipt before the seller does the work.
      receiptId: deriveReceiptId({
        payer: issued.payer,
        payee: this.config.payTo,
        tool: issued.tool,
        amount: issued.amount,
        nonce: issued.nonce,
      }),
      parentId: issued.parentId,
      expiresAt: issued.expiresAt,
      accepts: [
        {
          scheme: "exact",
          network,
          amount: issued.amount,
          asset: this.config.asset,
          payTo: settleTo,
          maxTimeoutSeconds: Math.max(1, Math.round((issued.expiresAt - Date.now()) / 1000)),
          extra: { assetTransferMethod: "eip3009" },
        },
      ],
    };
  }

  private receipt(
    paymentId: string,
    tool: string,
    amount: Minor,
    payer: string,
    parentId: string | null,
    status: Receipt["status"],
    payee = this.config.payTo,
    txHash?: string,
    payerSignature?: string,
  ): Receipt {
    return {
      paymentId,
      parentId,
      tool,
      payer,
      payee,
      amount: serializeMinor(amount),
      asset: this.config.asset,
      assetDecimals: this.config.assetDecimals,
      txHash,
      status,
      createdAt: Date.now(),
      payerSignature,
    };
  }

  /** Start an HTTP server exposing discovery + the priced MCP tool routes. */
  serve(port = this.config.port) {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void this.route(req, res).catch((err) => {
        const status = err instanceof GatewayError ? err.status : 500;
        json(res, status, { error: String(err instanceof Error ? err.message : err) });
      });
    });
    server.listen(port);
    return server;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === TIAGOH.DISCOVERY_PATH) {
      return json(res, 200, buildDiscoveryDocument(this.config));
    }
    if (req.method === "POST" && req.url === "/mcp/tools/list") {
      const upstream =
        (await this.opts.listUpstream?.()) ??
        this.config.tools.map((t) => ({ name: t.name, description: t.description }));
      return json(res, 200, { tools: annotatePrices(this.config, upstream) });
    }
    if (req.method === "POST" && req.url === "/mcp/tools/call") {
      const body = (await readJson(req)) as { tool: string; args?: unknown; payer?: string };
      const out = await this.handleToolCall({
        tool: body.tool,
        args: body.args,
        // `X-PAYMENT` is what the x402 v2 spec names; the tiagoh header predates it and stays
        // supported, so a standard x402 client and an existing tiagoh client both work.
        signature: header(req, TIAGOH.X402_PAYMENT_HEADER) ?? header(req, TIAGOH.PAYMENT_SIG_HEADER),
        nonce: header(req, TIAGOH.NONCE_HEADER),
        receiptSignature: header(req, TIAGOH.RECEIPT_SIG_HEADER),
        payer: body.payer,
        parentId: header(req, TIAGOH.PARENT_ID_HEADER) ?? null,
      });
      if (out.kind === "payment_required") {
        return json(res, 402, out.challenge);
      }
      res.setHeader(TIAGOH.PAYMENT_ID_HEADER, out.receipt.paymentId);
      return json(res, 200, { result: out.result, receipt: out.receipt });
    }
    json(res, 404, { error: "not found" });
  }
}

// ── tiny HTTP helpers ────────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
