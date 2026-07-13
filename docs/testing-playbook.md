# Testing playbook

A short path for a reviewer to confirm tiagoh works, both off chain and on chain, in a few minutes.

## Prerequisites

- Node 20+ and pnpm 10+
- Foundry (`forge`, `cast`) for the contract checks
- No wallet or funds are needed for any step except an optional on chain run

## Setup

```bash
pnpm install
pnpm -r --filter "./packages/**" build
```

## 1. Contracts (no chain, no gas)

```bash
pnpm contracts:setup      # fetches forge-std, OpenZeppelin, erc-8004 into contracts/lib
pnpm contracts:test       # forge test
```

Expected: `23 passed; 0 failed`. Covers receipts and dedupe, the cascade budget tree with an on chain
`BudgetExceeded` rejection, payment channel vouchers, quality bond slash to buyer, and the escrow and
dispute recourse path.

## 2. End to end x402 flow (no chain, no gas)

```bash
pnpm --filter @tiagoh/e2e demo
```

Expected output shows, in order:

- priced tools discovered with per call prices
- two paid calls over 402
- a failing tool that is not billed (charge on success), budget unchanged
- a cascade where `analyze_portfolio` buys 3 tools downstream, all linked to the root paymentId
- an over budget call rejected before signing (`BudgetExceeded`)
- `end-to-end x402 flow works`

## 3. Autonomous buyer (no chain, no gas)

```bash
pnpm --filter @tiagoh/e2e agent
```

Expected: the buyer discovers tools, reads on chain reputation (a free view call), pays a few under
budget, and a bad output (`flaky_data`) is caught by the verifier and disputed, so it is refunded and
excluded from the recommendation. Set `TIAGOH_AGENT_LIVE=1` with `ANTHROPIC_API_KEY` to run the same
loop with live Claude.

## 4. On chain proof (optional, needs a funded key)

The full suite is already live on GOAT Testnet3. Verify the receipt count and read a contract without
spending anything:

```bash
export RPC=https://rpc.testnet3.goat.network
cast call 0xb55822243ea12738A50De04B0AeE4f671732FFBb "count()(uint256)" --rpc-url $RPC
cast call 0xb55822243ea12738A50De04B0AeE4f671732FFBb "totalVolume()(uint256)" --rpc-url $RPC
```

To anchor fresh receipts yourself, fund the deployer and run:

```bash
TIAGOH_ONCHAIN=1 PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e demo
```

Every settled call prints an explorer link. Contract addresses and the exercised transactions are in
[`DEPLOYMENTS.md`](./DEPLOYMENTS.md).

## 5. Dashboard (live)

Open [tiagoh.vercel.app](https://tiagoh.vercel.app). It reads the deployed contracts client side, with
no backend:

- `/dashboard`: live receipt count and the cascade graph
- `/explorer`: a receipt driven leaderboard and the 10 contracts with explorer links
- `/auction`: the cleared reverse auction (winner, price, bids)
- `/disputes`: the dispute that was ruled for the buyer and refunded

## 6. MCP endpoint (live)

```bash
curl -s -X POST https://tiagoh.vercel.app/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: the three paid tiagoh tools (`get_goat_market_data`, `get_rwa_price`, `get_defi_yields`).
The same endpoint is listed in the ClawUp MCP marketplace.

## What is not real yet

Payment signing in the demos is a local mock. Real settlement through GOAT's hosted x402 facilitator
needs the x402 Integration Faucet token. The swap point is `createFacilitatorSettle` in
`@tiagoh/goat`, and the gateway `SettleFn` shape does not change when it lands.
