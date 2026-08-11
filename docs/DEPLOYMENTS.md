# tiagoh — Deployments

## GOAT mainnet (chainId 2345) — the live suite

- **RPC:** `https://rpc.goat.network` · **Explorer:** https://explorer.goat.network
- **Deployer / submitter:** [`0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516`](https://explorer.goat.network/address/0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516)
- **Payment token:** [`0x3022b87ac063DE95b1570F46f5e470F8B53112D8`](https://explorer.goat.network/address/0x3022b87ac063DE95b1570F46f5e470F8B53112D8)
  — real bridged **USDC.e** (Stargate), 6 decimals, and a genuine Circle **FiatTokenV2**:
  `transferWithAuthorization` / `receiveWithAuthorization` / `cancelAuthorization` / `permit` all
  present, EIP-712 domain `{name: "Bridged USDC (Stargate)", version: "2", chainId: 2345}`
  (verified against the token's own `DOMAIN_SEPARATOR`). This is why the canonical x402 `exact`
  scheme works here with no external facilitator.

The full structured record, including the retired DemoToken suites, is in
[`contracts/deployments/goat-mainnet.json`](../contracts/deployments/goat-mainnet.json).

| Contract | Address |
| --- | --- |
| **X402Settler** | [`0x630b7C9D965994A3F2a2254534260A67423B6672`](https://explorer.goat.network/address/0x630b7C9D965994A3F2a2254534260A67423B6672) |
| ReceiptRegistry | [`0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112`](https://explorer.goat.network/address/0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112) |
| RevenueSplit | `0x2EDCd213F6A54A32079EE48B0da576ACE949f498` |
| CascadeController | `0x3d7c7C21178F5d436004a1A44D42b8e7D0b322C8` |
| PaymentChannel | `0x096F12309D718FC6E97e142B55feF2120647aB8B` |
| QualityBond | `0x24Df4B7f3ECd1c5692D1e8FC91d46e119c355555` |
| EscrowVault | `0xD6136DEc8D553D71DC5e865b89cC03b42b08BbF9` |
| DisputeArbiter | `0x7fd534d61Baa0fB6Cc7D638A855e929B1a997291` |
| ReputationScorer | `0x35aD6433d2e532c0938D79353F6882f68F2d36D2` |
| ToolAuction | `0x83964A9e06661BE11DC702989FE7df4186a716Ea` |
| AgentRegistry | `0xE8B5a5057300eD093BC363C77772f334B0a36e2c` |
| SessionKeyDelegator | `0x307D63c900Fe15F8282f88bb8b9FF036c7Aac263` |
| BitVM2Arbiter | `0x835E17d82c7393e974A6316Ac8BBF01B2132dB7a` (deployed, deliberately **not** authorized) |

Reputation writes go to the **canonical** ERC-8004 registries, not a private fork:
Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` ·
Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` ·
Validation `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58`.

### X402Settler deployment (2026-08-09)

| Step | Tx |
| --- | --- |
| `CREATE X402Settler` | [`0xbec5e17f…`](https://explorer.goat.network/tx/0xbec5e17f1e3a792b73bd56b25f4a5bb2d8916dd58c82dc2f3df3ba181752cee2) |
| `ReceiptRegistry.setRecorder(settler, true)` | [`0xe852868e…`](https://explorer.goat.network/tx/0xe852868e5e143a0d52bc8d10baad4ae257a203a391da209a748ae0f1284e059b) |
| `setOperator(gateway, true)` | [`0xf56d814b…`](https://explorer.goat.network/tx/0xf56d814b2f1f4da062b64fbfc2e5fba7e8e2b4e9c247c9316e9143d06dbcd45c) |
| `setMaxSettlement($5)` | [`0xa1d871f0…`](https://explorer.goat.network/tx/0xa1d871f04b048d50843de692630c858521ef6b9a0c504d36c6ce8cdfa7cd0c5a) |

1,201,473 gas total ≈ **15.6 satoshi**. Live configuration, readable on chain:

```
feeBps          0          # off until switched on deliberately
MAX_FEE_BPS     500        # 5% hard ceiling, enforced in the setter
maxSettlement   5000000    # $5 guarded-launch cap per settlement
isRecorder      true       # granted on ReceiptRegistry
```

### Governance — TimelockController (2026-08-09)

[`0x14a19a0204a789F5fE1Eb498902D02ec5a8C08AB`](https://explorer.goat.network/address/0x14a19a0204a789F5fE1Eb498902D02ec5a8C08AB)
· `minDelay` **6 hours** · proposer + admin: the deployer · executor `address(0)` (anyone, once
the delay has elapsed).

**Complete.** All **11 ownable contracts** are now owned by the timelock — `owner()` returns it
on every one, and none is left on an EOA. The handover ran as a scheduled batch
(`0xb25f7409321ea01be8e4bb6060c0f257bc65e739245a981d1f3a2e008a385463`, executed after the 6-hour
delay elapsed). Because the contracts are `Ownable2Step` the deployer stayed owner throughout the
waiting period, so a mistyped governance address could never have stranded anything.

| Contract | `owner()` |
| --- | --- |
| X402Settler · ReceiptRegistry · RevenueSplit · CascadeController · QualityBond · EscrowVault · DisputeArbiter · ReputationScorer · ToolAuction · AgentRegistry · BitVM2Arbiter | `0x14a19a02…` (timelock) |

Ownership does not touch the operational roles, and a real payment was settled after the handover
to confirm it: `isRecorder(settler)`, `isRecorder(deployer)` and `isOperator(deployer)` are all
still true, and a zero-gas buyer completed a co-signed purchase.

Any privileged call now takes three steps and at least six hours:

```bash
cast send $TIMELOCK "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  $TARGET 0 $CALLDATA 0x00…00 $SALT 21600 --rpc-url https://rpc.goat.network
# …6 hours, publicly visible…
cast send $TIMELOCK "execute(address,uint256,bytes,bytes32,bytes32)" \
  $TARGET 0 $CALLDATA 0x00…00 $SALT --rpc-url https://rpc.goat.network
```

> **This is delay, not decentralization — and the distinction matters.** The proposer is still a
> single EOA, so one key can still make any change; it just cannot make it *quietly or instantly*.
> Every privileged call is now announced 6 hours in advance and executable by anyone, which is what
> turns a silent compromise into a visible one. Real separation needs a Safe multisig as proposer
> and the deployer's admin role renounced. Six hours rather than the two-day default because the
> suite is still being iterated on; raise it through the timelock once it settles.
>
> `PaymentChannel` and `SessionKeyDelegator` are not in the list: neither has an owner.

### First external payments — a wallet with zero gas (2026-08-09)

`0x131d9db0888B1f182d3ffCd91A38333B4117e13c` was funded with **0.20 USDC.e and no BTC at all**,
then paid a gateway running in a separate process that never held its key.

| What | Tx | Result |
| --- | --- | --- |
| `get_goat_chain_stats` $0.01, fee 0% | [`0x25d76b35…`](https://explorer.goat.network/tx/0x25d76b3545427abf0c62747bc1a1563013f6eb1a95474ee9abfa0e880a00bca8) | 323,528 gas, one transaction |
| `get_token_info` $0.02, **fee 2%** | [`0x11648cce…`](https://explorer.goat.network/tx/0x11648cce62ccc7c68226a48961942afc0231fcad9ee9d342d4885c207f0dfe8c) | treasury `0.000400`, seller `0.019600` |

Six events inside the *single* settlement transaction — `AuthorizationUsed` →
`Transfer` buyer→settler → `Transfer` settler→seller → `ReceiptRecorded` →
`ReceiptAttested(2 = COSIGNED)` → `Settled`. The payment and its evidence cannot come apart.

Verified independently against the chain afterwards:

```
buyer BTC balance      0 sats        unchanged — the buyer never sent a transaction
buyer USDC.e           0.200 → 0.170
seller USDC.e          0.029600      earned
seller nonce           0             never sent a transaction either
settler USDC.e         0             a conduit, holds nothing
ReceiptRegistry.count  13 → 15
cosignedCount          0 → 2         first dispute-grade receipts on the live suite
```

The fee was switched on for the second call and back to 0 immediately after
([`0x563bfa01…`](https://explorer.goat.network/tx/0x563bfa011fcbd677623b61cae2e387fcb7cd8fb0e2d8c177f74cea740debf65b)),
so the deployed default remains 0%.

## GOAT Testnet3 (chainId 48816) — historical

- **RPC:** `https://rpc.testnet3.goat.network`
- **Explorer:** https://explorer.testnet3.goat.network
- **Deployer:** [`0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516`](https://explorer.testnet3.goat.network/address/0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516)

All 13 contracts of the tiagoh trust-layer suite are live and verified on-chain (real bytecode).

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
| SessionKeyDelegator | [`0x24Df…5555`](https://explorer.testnet3.goat.network/address/0x24Df4B7f3ECd1c5692D1e8FC91d46e119c355555) | [`0x2fd47d…`](https://explorer.testnet3.goat.network/tx/0x2fd47d11652a10b2b22db883800129f65f8e8d338618e74ad258f71f88b3f57a) |
| BitVM2Arbiter | [`0x35aD…36D2`](https://explorer.testnet3.goat.network/address/0x35aD6433d2e532c0938D79353F6882f68F2d36D2) | [`0x8b7898…`](https://explorer.testnet3.goat.network/tx/0x8b7898aac5da5708ec7914e8f8aa936bf8e5d234abd4137ba52cec76aac0f44d) |
| ERC8004ReputationRegistry | [`0x59AB…88A2`](https://explorer.testnet3.goat.network/address/0x59ABEE0BA201E99AEAa2E80141D291e2ac4a88A2) | [`0x35f2aa…`](https://explorer.testnet3.goat.network/tx/0x35f2aa4037ffb331c023ad401788dee4d8046b83c55dbdf20faee0c13dfcec52) |

Structured record: [`contracts/deployments/goat-testnet3.json`](../contracts/deployments/goat-testnet3.json).
The core suite deployed with `forge script script/Deploy.s.sol --broadcast`; the three trust-layer
additions with `forge script script/DeployScaffolds.s.sol --broadcast` (gas paid in BTC).

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
| Session keys (ERC-4337) | `grant(sk, cap 1000)` → off-key signed `spend(400)` recovers the session key on-chain → `remaining`=600 |
| BitVM2 arbiter | recourse wired to QualityBond + EscrowVault → `openDispute` → `propose(forBuyer)` → `rule` → **`RULED`** (`DisputeRuled` + `RecourseExecuted`) |
| ERC-8004 reputation | `registerAgent(tool)` → agentId 1 → `giveFeedback(+100, 'tiagoh'/'success')` → `getSummary` count 1, sumWad `1e20` |

## End-to-end x402 pipeline → real on-chain receipts

The off-chain flow (`agent → paying client → gateway (402) → charge-on-success`) anchored real
receipts to `ReceiptRegistry` on GOAT Testnet3 (`count` 8 → 14). The cascade run's downstream hops
link to the `analyze_portfolio` root receipt. Reproduce: `TIAGOH_ONCHAIN=1 pnpm --filter @tiagoh/e2e demo`.

| Call | Tx |
| --- | --- |
| get_goat_market_data | [`0xf1ff3d…`](https://explorer.testnet3.goat.network/tx/0xf1ff3d3cd578e5931cef4e39100e3971eac94e8e822254eb03017ce955d98dc5) |
| get_rwa_price | [`0x8b52a6…`](https://explorer.testnet3.goat.network/tx/0x8b52a6066bf1cd91bd8e226817a82f57c341066ff7d4f542c632e54e71c3f26d) |
| cascade · get_rwa_price | [`0x328d0b…`](https://explorer.testnet3.goat.network/tx/0x328d0b415a5f6cce8d6c6ebd7870bde3fb531d0b5c8dd013be4d88add7c118a9) |
| cascade · get_goat_market_data | [`0x6d9cbd…`](https://explorer.testnet3.goat.network/tx/0x6d9cbd2e9337a35639cdde2582a4e2a78986725e3c080c7d69ea51e18a488839) |
| cascade · get_defi_yields | [`0x1b4543…`](https://explorer.testnet3.goat.network/tx/0x1b45434a3183fca5c7cb3a44d240f580c3a8187206d13d68854df928de0f11eb) |
| cascade root · analyze_portfolio | [`0x1062ab…`](https://explorer.testnet3.goat.network/tx/0x1062ab2bb121078b46f31b91fe929a35e6802a34800755511946220650b041f4) |
