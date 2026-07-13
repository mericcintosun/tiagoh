# tiagoh — Deployments

## GOAT Testnet3 (chainId 48816)

- **RPC:** `https://rpc.testnet3.goat.network`
- **Explorer:** https://explorer.testnet3.goat.network
- **Deployer:** [`0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516`](https://explorer.testnet3.goat.network/address/0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516)

All 10 contracts of the tiagoh trust-layer suite are live and verified on-chain (real bytecode).

| Contract | Address | Deploy tx |
| --- | --- | --- |
| ReceiptRegistry | [`0xb558…FFBb`](https://explorer.testnet3.goat.network/address/0xb55822243ea12738A50De04B0AeE4f671732FFBb) | [`0x294daa…`](https://explorer.testnet3.goat.network/tx/0x294daa618f5eabb19944244c72cf422a8c4b8d60f74ef7421ecd87218969879e) |
| RevenueSplit | [`0x9A84…cd23`](https://explorer.testnet3.goat.network/address/0x9A846F7bEAF29622579EF71D095Ae96c7345cd23) | [`0xb47cac…`](https://explorer.testnet3.goat.network/tx/0xb47cacfa0b3c5a0016db769bf95d57930ec70826369e3db17c5a8b8f0381b662) |
| CascadeController | [`0x9a41…f1AA`](https://explorer.testnet3.goat.network/address/0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA) | [`0x2be12a…`](https://explorer.testnet3.goat.network/tx/0x2be12ac60d3db49b013a89267a397366d8785e96ae850d9fbd28f01a07612e17) |
| PaymentChannel | [`0x0193…aBC5`](https://explorer.testnet3.goat.network/address/0x0193b4865a13955EF646e6532cd024028165aBC5) | [`0xa7bef3…`](https://explorer.testnet3.goat.network/tx/0xa7bef30c2e65a56ba04658950dc03b16ce68a9628fc25592354ba919a507190d) |
| QualityBond | [`0xCed3…A4E0`](https://explorer.testnet3.goat.network/address/0xCed393a33e999C14a2E343DAA36fbEb84ce1A4E0) | [`0x0d0cf0…`](https://explorer.testnet3.goat.network/tx/0x0d0cf0fac077c1a7fb4af9ab8f8f5e9366b68ed1db1c6f5b090ff36862d20f48) |
| EscrowVault | [`0x283c…45A7`](https://explorer.testnet3.goat.network/address/0x283c174Abf7F868Cda7B038C4a45CbCa45Aa45A7) | [`0x9f23dc…`](https://explorer.testnet3.goat.network/tx/0x9f23dc573e24c509e5ca8e0bfedd1dbbb7c59136edd496885f51cf0c3ac57632) |
| DisputeArbiter | [`0x0b59…e980`](https://explorer.testnet3.goat.network/address/0x0b592E60706695Dc1E84bFda4f2ec59dc660e980) | [`0x905c9d…`](https://explorer.testnet3.goat.network/tx/0x905c9d44dc60557a374e22e4e64a619d1e0afa38ea4578a6c00e814b9d546caf) |
| ReputationScorer | [`0x10d7…C695`](https://explorer.testnet3.goat.network/address/0x10d7eC7fEbCB3009e2842B35616eA1609249C695) | [`0x0d2651…`](https://explorer.testnet3.goat.network/tx/0x0d26518a484c36f49c466ea48e9e9e3ff54da8de5ec8750a59d396bd8f66c1d4) |
| ToolAuction | [`0x4D2E…C9d7`](https://explorer.testnet3.goat.network/address/0x4D2E9E59be3C600a634b6f5e09C7966DED09C9d7) | [`0xea3bee…`](https://explorer.testnet3.goat.network/tx/0xea3bee26687a5df8556c0dfccd881b4e5e2271348480e4a4376bb23be5bd8cd6) |
| AgentRegistry | [`0x13E1…1215`](https://explorer.testnet3.goat.network/address/0x13E12daAAFDb5E1fe53499BEa8D955Aa0B471215) | [`0x47f4a5…`](https://explorer.testnet3.goat.network/tx/0x47f4a57dfe2a101f119da2b301af9068039e1b98df7c4d4c362c38bd23abfb7b) |

Structured record: [`contracts/deployments/goat-testnet3.json`](../contracts/deployments/goat-testnet3.json).
Deployed with `forge script script/Deploy.s.sol --broadcast` (gas paid in BTC; ~0.0000015 BTC total).

## Live-exercised on GOAT Testnet3 (real transactions)

Every feature primitive was driven end-to-end on-chain with the demo payment token
`0x4ca4edff504bb87d95a4deab67507bb1201de948` (tUSD). QualityBond and RevenueSplit were
redeployed bound to that token to exercise real transfers.

| Feature | Proven on-chain |
| --- | --- |
| On-chain receipts | 5 receipts anchored; cascade fan-out `childCount[root]=3`; multi-level `root→child→grandchild` (depth 3) |
| Cascade (budget tree) | `open(1000)` → analyst 100 → data 30 @20% attribution (analyst +6 / data +24) → over-budget hop **`BudgetExceeded`** → close refunds 870 |
| Quality bonds (§5.2) | BRONZE bond 1000 staked → arbiter `slash(300)` to buyer → `bondAmount` 700 |
| Escrow + dispute (§5.4) | escrow 500 held → dispute **ruled for buyer** → escrow refunded + bond slashed to buyer |
| Atomic multi-hop refund (§5.4) | 3 held escrows atomically refunded in one `unwindCascade` tx (all → `REFUNDED`) |
| Reputation (§5.1) | `recordSuccess ×2` → `scoreOf`=25; `recordDispute` → `scoreOf`=0 (outcome-driven) |
| Delegation (§5.3) | delegate cap 500, spend 200, remaining 300, over-cap spend → **`CapExceeded`** |
| Auction (§5.5) | 3 signed bids (80/50/65) → `clear` picks lowest-price winner @50 → `settle` |
| Revenue splits | fund 1000, 60/40 → `release` P1=600 / P2=400 |
| Prepaid channels | `open(1000)` → redeem vouchers 300 then 500 (recipient +500) → stale voucher **`NonMonotonic`** → close refunds 500 |
