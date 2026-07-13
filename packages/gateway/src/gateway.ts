import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { TIAGOH, type Receipt, type TiagohConfig } from "@tiagoh/core";
import { priceForTool } from "./pricing.js";
import { buildDiscoveryDocument } from "./discovery.js";

export type SettleFn = (args: {
  tool: string;
  amountUsd: number;
  payer: string;
  parentId: string | null;
  signature: string;
}) => Promise<{ txHash?: string; payee: string }>;

export type UpstreamCall = (tool: string, args: unknown) => Promise<unknown>;

export interface GatewayOptions {
  config: TiagohConfig;
  /** Calls the wrapped upstream MCP tool. */
  callUpstream: UpstreamCall;
  /** Settles an x402 payment via the GOAT facilitator (see @tiagoh/goat). */
  settle: SettleFn;
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

    // Free tool → run and return, no payment.
    if (!price || price.priceUsd === 0) {
      const result = await this.opts.callUpstream(input.tool, input.args);
      const receipt = this.receipt(input.tool, 0, input.payer ?? "anon", input.parentId ?? null, "settled");
      return { kind: "ok", result, receipt };
    }

    // Unpaid → 402 challenge.
    if (!input.signature) {
      return { kind: "payment_required", priceUsd: price.priceUsd, asset: this.config.asset };
    }

    // Paid → run upstream FIRST; only settle if it succeeds.
    const result = await this.opts.callUpstream(input.tool, input.args);
    const { txHash, payee } = await this.opts.settle({
      tool: input.tool,
      amountUsd: price.priceUsd,
      payer: input.payer ?? "anon",
      parentId: input.parentId ?? null,
      signature: input.signature,
    });
    const receipt = this.receipt(input.tool, price.priceUsd, input.payer ?? "anon", input.parentId ?? null, "settled", payee, txHash);
    this.opts.onReceipt?.(receipt);
    return { kind: "ok", result, receipt };
  }

  private receipt(
    tool: string,
    amountUsd: number,
    payer: string,
    parentId: string | null,
    status: Receipt["status"],
    payee = this.config.payTo,
    txHash?: string,
  ): Receipt {
    return {
      paymentId: randomUUID(),
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

  /** Start an HTTP server exposing the MCP endpoint + discovery document. */
  serve(port = this.config.port) {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === TIAGOH.DISCOVERY_PATH) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(buildDiscoveryDocument(this.config)));
        return;
      }
      // TODO: bridge JSON-RPC MCP messages to handleToolCall (parentId from headers).
      res.writeHead(404).end();
    });
    server.listen(port);
    return server;
  }
}
