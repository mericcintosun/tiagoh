/**
 * x402 — ready to use, straight from @goatnetwork/agentkit.
 *
 * The seller gateway uses the merchant-gateway adapter to price + settle;
 * the buyer client uses the payer-wallet adapter to sign the ERC-3009 /
 * Permit2 authorization and retry. tiagoh composes these actions into the
 * per-tool-call x402 flow.
 */
import {
  createPaymentAction,
  submitSignatureAction,
  transferPaymentAction,
  paymentStatusAction,
  cancelPaymentAction,
  HttpMerchantGatewayAdapter,
  EvmPayerWalletAdapter,
  NoopPayerWalletAdapter,
} from "@goatnetwork/agentkit";

export {
  createPaymentAction,
  submitSignatureAction,
  transferPaymentAction,
  paymentStatusAction,
  cancelPaymentAction,
  HttpMerchantGatewayAdapter,
  EvmPayerWalletAdapter,
  NoopPayerWalletAdapter,
};

export type {
  MerchantGatewayAdapter,
  PayerWalletAdapter,
  PaymentStatus,
  CalldataSignRequest,
} from "@goatnetwork/agentkit";

/** The full x402 action set, ready to hand to `toMcpTools` or an ExecutionRuntime. */
export const X402_ACTIONS = [
  createPaymentAction,
  submitSignatureAction,
  transferPaymentAction,
  paymentStatusAction,
  cancelPaymentAction,
] as const;
