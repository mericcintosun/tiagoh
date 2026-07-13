# x402 for MCP: the tiagoh wire conventions

A small, reusable convention for pricing and paying for MCP tools over x402, plus the two things
raw x402 does not cover: cascade attribution and receipt anchoring. Any x402 agent or MCP host can
follow it. tiagoh implements it, but nothing here is tiagoh specific.

Status: draft v0.1. Network in examples: GOAT Testnet3 (chainId 48816).

## 1. Terms

- **Gateway**: the seller side. It wraps an MCP server, prices its tools, and runs the payment flow.
- **Client**: the buyer side. It answers payment challenges under a spending budget.
- **Tool call**: one MCP `tools/call`. This is the unit that gets priced and paid.
- **Cascade**: a tree of tool calls, formed when a paid tool itself calls other paid tools.
- **Receipt**: an on-chain record of one settled call, carrying the id of its parent call.

## 2. Discovery

Every gateway serves a Bazaar compatible catalog so an agent can find priced tools before calling.

```
GET /.well-known/x402.json
```

```json
{
  "x402Version": 1,
  "network": "goat:48816",
  "asset": "0x…",
  "payTo": "0x…",
  "resources": [
    { "resource": "tool:get_rwa_price", "description": "tokenized RWA prices",
      "price": { "amountUsd": 0.02, "asset": "0x…" }, "mimeType": "application/json" }
  ]
}
```

Prices are also advertised inline on the MCP `tools/list` response, so a host that already speaks MCP
does not need a second request:

```json
{ "name": "get_rwa_price", "description": "…",
  "_meta": { "tiagoh": { "priceUsd": 0.02, "asset": "0x…" } } }
```

A tool with no advertised price is free.

## 3. Payment flow, per call

MCP speaks JSON-RPC over one HTTP endpoint, so each priced tool maps to a synthetic x402 route.

1. The client calls the tool. With no payment header, the gateway answers `402 Payment Required`:

   ```
   POST /mcp/tools/call   { "tool": "get_rwa_price", "args": { "asset": "gold" } }
   → 402   { "priceUsd": 0.02, "asset": "0x…" }
   ```

2. The client checks its budget. If the price would breach a per call or per session cap, it aborts
   before signing and never pays. Otherwise it signs an ERC-3009 `transferWithAuthorization`
   (EIP-712) for the price and retries with the signature header:

   ```
   POST /mcp/tools/call   (same body)
   Header: x-payment-signature: 0x…
   ```

3. The gateway runs the upstream tool first, then settles the payment only if the call succeeded.
   A failed call is never billed. This is charge on success.

   ```
   → 200   { "result": { … }, "receipt": { "paymentId": "…", "amountUsd": 0.02, … } }
   Header: x-tiagoh-payment-id: …
   ```

Charge on success is a payment rule, not a quality rule. A tool that returns a well formed but wrong
answer is still billed here. Quality is handled by bonds and disputes (section 6).

## 4. Cascade attribution

When the gateway settles a call, it mints a `paymentId` and passes it to the upstream tool. If that
tool buys from other paid tools, its client forwards the id downstream:

```
Header: x-tiagoh-parent-id: <parent paymentId>
```

Each downstream receipt records this value as its `parentId`. The full call tree reconstructs from
receipts alone, with no central coordinator. A single root deposit can therefore cap the whole tree,
and a configurable share of a child hop's amount can flow up to the parent hop's payee. That budget
tree and upward attribution are enforced on chain by the `CascadeController` contract.

## 5. Receipts

Every settled call is anchored on chain in a `ReceiptRegistry`:

```
recordReceipt(bytes32 receiptId, bytes32 parentId, address payer, address payee,
              address token, uint256 amount, bytes32 toolId)
```

`receiptId = keccak256(paymentId)`, `parentId = keccak256(parent paymentId)` or zero for a root, and
`toolId = keccak256(tool name)`. `childCount[parentId]` gives the fan out of any hop. Two facts become
verifiable without trusting the gateway: that a call was paid, and how payments compose.

## 6. Trust signals: bonds, reputation, disputes

The convention leaves room for trust guarantees on top of the payment.

- **Bond**: a seller can stake a `QualityBond` against a tool. Bond size and slash history are a
  discoverable signal at payment time.
- **Reputation**: settled receipts, refunds, disputes, and slashes feed an on chain reputation score
  per tool and per agent. Agents rank by proven outcomes rather than marketing.
- **Dispute**: a buyer can open a dispute over a paid call. A buyer favorable ruling refunds the
  escrowed payment and slashes the tool's bond to the buyer. Rulings feed reputation.

These are optional. A gateway that only implements sections 2 through 5 still interoperates.

## 7. Header reference

| Header | Direction | Meaning |
| --- | --- | --- |
| `x-payment-signature` | client → gateway | the signed x402 authorization on retry |
| `x-tiagoh-parent-id` | client → gateway | cascade parent paymentId for this call |
| `x-tiagoh-payment-id` | gateway → client | the settled paymentId (echoed) |

## 8. Reference implementation

tiagoh implements all of the above: `packages/gateway` (seller), `packages/client` (buyer),
`packages/goat` (x402 + ERC-8004 + on chain settle), and `contracts` (the on chain layer). Run the
flow end to end with `pnpm --filter @tiagoh/e2e demo`.
