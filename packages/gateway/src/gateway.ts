import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { TIAGOH, type Receipt, type TiagohConfig } from "@tiagoh/core";
import { priceForTool, annotatePrices } from "./pricing.js";
import { buildDiscoveryDocument } from "./discovery.js";

export type SettleFn = (args: {
  paymentId: string;
  tool: string;
  amountUsd: number;
  payer: string;
  parentId: string | null;
  signature: string;
}) => Promise<{ txHash?: string; payee: string }>;

export type VerifyPaymentFn = (args: {
  tool: string;
  priceUsd: number;
  asset: string;
  signature: string;
  payer: string;
  parentId: string | null;
}) => Promise<boolean>;

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
   * Verifies the payment authorization BEFORE the upstream tool runs (the x402
   * verify step; the facilitator's /verify on mainnet). An invalid or unverifiable
   * signature is re-challenged with a 402 instead of executing the tool, so the
   * seller never does work against a signature that cannot settle. When unset,
   * verification is deferred entirely to `settle` (mock/testnet behavior).
   */
  verifyPayment?: VerifyPaymentFn;
  /** Sink for anchored receipts (e.g. ReceiptRegistry writer). */
  onReceipt?: (receipt: Receipt) => void;
}

/**
 * The seller gateway. Prices each tool, returns a 402 challenge when a call is
 * unpaid, and — crucially — only settles the payment if the upstream tool
 * *succeeds* (charge-on-success). A failed call is never billed.
 */
export class TiagohGateway {
  constructor(private readonly opts: GatewayOptions) {}

  get config(): TiagohConfig {
    return this.opts.config;
  }

  /** Core per-call flow, transport-agnostic. */
  async handleToolCall(input: {
    tool: string;
    args: unknown;
    signature?: string;
    payer?: string;
    parentId?: string | null;
  }): Promise<
    | { kind: "payment_required"; priceUsd: number; asset: string }
    | { kind: "ok"; result: unknown; receipt: Receipt }
  > {
    const price = priceForTool(this.config, input.tool);
    const parentId = input.parentId ?? null;
    const payer = input.payer ?? "anon";

    // Free tool → run and return, no payment.
    if (!price || price.priceUsd === 0) {
      const paymentId = randomUUID();
      const result = await this.opts.callUpstream(input.tool, input.args, { paymentId, parentId });
      const receipt = this.receipt(paymentId, input.tool, 0, payer, parentId, "settled");
      this.opts.onReceipt?.(receipt);
      return { kind: "ok", result, receipt };
    }

    // Unpaid → 402 challenge.
    if (!input.signature) {
      return { kind: "payment_required", priceUsd: price.priceUsd, asset: this.config.asset };
    }

    // Paid → verify the authorization first (never run the tool against a signature
    // that cannot settle). A failed or errored verification re-challenges with 402.
    if (this.opts.verifyPayment) {
      let valid = false;
      try {
        valid = await this.opts.verifyPayment({
          tool: input.tool,
          priceUsd: price.priceUsd,
          asset: this.config.asset,
          signature: input.signature,
          payer,
          parentId,
        });
      } catch {
        valid = false;
      }
      if (!valid) {
        return { kind: "payment_required", priceUsd: price.priceUsd, asset: this.config.asset };
      }
    }

    // Mint the paymentId, run upstream FIRST (it may cascade using this id
    // as the parent), and only settle if the tool succeeds (charge-on-success).
    const paymentId = randomUUID();
    const result = await this.opts.callUpstream(input.tool, input.args, { paymentId, parentId });
    const { txHash, payee } = await this.opts.settle({
      paymentId,
      tool: input.tool,
      amountUsd: price.priceUsd,
      payer,
      parentId,
      signature: input.signature,
    });
    const receipt = this.receipt(paymentId, input.tool, price.priceUsd, payer, parentId, "settled", payee, txHash);
    this.opts.onReceipt?.(receipt);
    return { kind: "ok", result, receipt };
  }

  private receipt(
    paymentId: string,
    tool: string,
    amountUsd: number,
    payer: string,
    parentId: string | null,
    status: Receipt["status"],
    payee = this.config.payTo,
    txHash?: string,
  ): Receipt {
    return {
      paymentId,
      parentId,
      tool,
      payer,
      payee,
      amountUsd,
      asset: this.config.asset,
      txHash,
      status,
      createdAt: Date.now(),
    };
  }

  /** Start an HTTP server exposing discovery + the priced MCP tool routes. */
  serve(port = this.config.port) {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void this.route(req, res).catch((err) => json(res, 500, { error: String(err) }));
    });
    server.listen(port);
    return server;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === TIAGOH.DISCOVERY_PATH) {
      return json(res, 200, buildDiscoveryDocument(this.config));
    }
    if (req.method === "POST" && req.url === "/mcp/tools/list") {
      const upstream = (await this.opts.listUpstream?.()) ?? this.config.tools.map((t) => ({ name: t.name, description: t.description }));
      return json(res, 200, { tools: annotatePrices(this.config, upstream) });
    }
    if (req.method === "POST" && req.url === "/mcp/tools/call") {
      const body = (await readJson(req)) as { tool: string; args?: unknown; payer?: string };
      const signature = header(req, TIAGOH.PAYMENT_SIG_HEADER);
      const parentId = header(req, TIAGOH.PARENT_ID_HEADER) ?? null;
      const out = await this.handleToolCall({ tool: body.tool, args: body.args, signature, payer: body.payer, parentId });
      if (out.kind === "payment_required") {
        return json(res, 402, { priceUsd: out.priceUsd, asset: out.asset });
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
