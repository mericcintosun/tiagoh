# x402 for MCP: the tiagoh wire conventions

A small, reusable convention for pricing and paying for MCP tools over x402, plus the two things
raw x402 does not cover: cascade attribution and receipt anchoring. Any x402 agent or MCP host can
follow it. tiagoh implements it, but nothing here is tiagoh specific.

Status: draft v0.2, aligned with **x402 v2**. Network in examples: GOAT mainnet (`eip155:2345`).

The payment itself is not a tiagoh invention: it is the canonical x402 `exact` scheme over
ERC-3009, so a standard x402 client can pay a tiagoh gateway without knowing anything about
tiagoh. Sections 4–6 are the parts x402 does not cover.

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
  "x402Version": 2,
  "network": "eip155:2345",
  "asset": "0x3022b87a…",
  "assetDecimals": 6,
  "payTo": "0x…",
  "settleTo": "0x630b7C9D…",
  "resources": [
    { "resource": "tool:get_rwa_price", "description": "tokenized RWA prices",
      "price": { "amount": "20000", "asset": "0x3022b87a…", "assetDecimals": 6 },
      "mimeType": "application/json",
      "accepts": [{ "scheme": "exact", "network": "eip155:2345", "amount": "20000",
                    "asset": "0x3022b87a…", "payTo": "0x630b7C9D…",
                    "maxTimeoutSeconds": 120,
                    "extra": { "assetTransferMethod": "eip3009" } }] }
  ]
}
```

Prices are exact integer **minor units** as a string, never a float: the receipt is co-signed and
anchored, so its amount has to be exactly the integer both signatures cover.

Prices are also advertised inline on the MCP `tools/list` response, so a host that already speaks MCP
does not need a second request:

```json
{ "name": "get_rwa_price", "description": "…",
  "_meta": { "tiagoh": { "amount": "20000", "asset": "0x3022b87a…", "assetDecimals": 6,
                         "priceUsd": 0.02 } } }
```

`priceUsd` is for humans reading the listing. Pay and account off `amount`.

A tool with no advertised price is free.

## 3. Payment flow, per call

MCP speaks JSON-RPC over one HTTP endpoint, so each priced tool maps to a synthetic x402 route.

1. The client calls the tool. With no payment header, the gateway answers `402 Payment Required`
   with everything needed both to pay and to pre-sign the receipt:

   ```
   POST /mcp/tools/call   { "tool": "get_rwa_price", "args": { "asset": "gold" }, "payer": "0x…" }
   → 402
   {
     "amount": "20000",                  // exact minor units, never a float
     "asset": "0x3022b87a…",             // USDC.e
     "assetDecimals": 6,
     "network": "eip155:2345",
     "payTo": "0x…",                     // the seller: receipt payee, and who co-signs it
     "settleTo": "0x630b7C9D…",          // where the money goes (X402Settler, or payTo)
     "tool": "get_rwa_price",
     "nonce": "0x…",                     // single-use; also the ERC-3009 authorization nonce
     "receiptId": "0x…",                 // deterministic, so the buyer can sign before the work
     "parentId": null,                   // cascade parent, signed by both parties
     "expiresAt": 1786301394000,
     "accepts": [{ "scheme": "exact", "network": "eip155:2345", "amount": "20000",
                   "asset": "0x3022b87a…", "payTo": "0x630b7C9D…",
                   "maxTimeoutSeconds": 120, "extra": { "assetTransferMethod": "eip3009" } }]
   }
   ```

   `payTo` and `settleTo` differ whenever a settler contract is in the path: the address that
   *receives* the transfer cannot also be the address that *signs* the receipt.

2. The client checks its budget. If the price would breach a per call or per session cap it aborts
   **before signing** and never pays. Otherwise it signs an ERC-3009 `TransferWithAuthorization`
   over the token's own EIP-712 domain, with `to = settleTo`, `value = amount`,
   `nonce = challenge.nonce` and `validBefore = expiresAt`, and retries:

   ```
   POST /mcp/tools/call   (same body)
   X-PAYMENT: <base64 x402 v2 payload>          # x-payment-signature is accepted as an alias
   x-tiagoh-nonce: 0x…
   x-tiagoh-receipt-signature: 0x…              # optional, but required for any recourse
   ```

   Reusing the challenge nonce as the authorization nonce is what makes the payment single-use at
   the **token** level: `authorizationState` is the replay guard, not the gateway's memory.

   The buyer needs **no native gas** — whoever relays the authorization pays it.

3. The gateway verifies the authorization before doing any work, by simulating the transfer with
   `eth_call`. That answers the same question a facilitator's `/verify` answers — is this valid and
   settleable right now — with no trusted third party. An unverifiable payment is re-challenged
   with a fresh 402 rather than served.

4. The gateway runs the upstream tool, counter-signs the receipt, then settles. A failed call is
   never billed (charge on success), and the counter-signature comes *before* settlement so the
   payment and the receipt can be anchored in one transaction.

   ```
   → 200   { "result": { … }, "receipt": { "paymentId": "…", "amount": "20000", … } }
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
| `X-PAYMENT` | client → gateway | base64 x402 v2 `exact` payload (signature + authorization) |
| `x-payment-signature` | client → gateway | alias for `X-PAYMENT`, accepted for compatibility |
| `x-tiagoh-nonce` | client → gateway | the challenge nonce, echoed to spend it |
| `x-tiagoh-receipt-signature` | client → gateway | the buyer's EIP-712 signature over the receipt |
| `x-tiagoh-parent-id` | client → gateway | cascade parent paymentId for this call |
| `x-tiagoh-payment-id` | gateway → client | the settled paymentId (echoed) |

## 8. Reference implementation

tiagoh implements all of the above: `packages/gateway` (seller), `packages/client` (buyer),
`packages/goat` (x402 + ERC-8004 + on chain settle), and `contracts` (the on chain layer). Run the
flow end to end with `pnpm --filter @tiagoh/e2e demo`.
