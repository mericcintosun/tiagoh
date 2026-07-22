# tiagoh — Demo Video Script (max 3 min)

**Goal:** show tiagoh is a real, live product on GOAT mainnet — the payment + trust layer
for AI-agent tools. No timeline; just record each scene in order.

## Before you record (setup)
- Open tabs: **tiagoh.vercel.app**, **tiagoh.vercel.app/pitch**, the **GOAT explorer**
  (ReceiptRegistry page below), and a **terminal**.
- Explorer link (ReceiptRegistry, live on mainnet):
  `https://explorer.goat.network/address/0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA`
- (Optional "money shot") Pre-run the mainnet demo once so real receipts already exist, then run
  it again on camera. Command:
  ```
  TIAGOH_ONCHAIN=1 \
  PRIVATE_KEY=<your key> \
  RECEIPT_REGISTRY_ADDRESS=0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA \
  TIAGOH_PAYMENT_TOKEN=0xb55822243ea12738A50De04B0AeE4f671732FFBb \
  pnpm --filter @tiagoh/e2e demo
  ```
  Each call anchors a real receipt on GOAT mainnet (costs a few cents of BTC).

---

## The flow (5 scenes)

### Scene 1 — The problem
**[SHOW]** tiagoh.vercel.app hero.
**[SAY]** "AI agents can use thousands of tools. Almost all of them are free — because there was
never a clean way to charge an agent for a single call. So builders give their best work away."

### Scene 2 — What tiagoh is
**[SHOW]** Scroll the landing "how it works", or the /pitch deck (arrow keys).
**[SAY]** "tiagoh puts a paywall in front of any AI tool, with one command. The agent pays a few
cents per call, in x402. And it settles on GOAT — with Bitcoin finality. We charge only when the
call actually works."

### Scene 3 — Live on GOAT mainnet (the proof)
**[SHOW]** The GOAT explorer → ReceiptRegistry contract → the genesis receipt transaction.
**[SAY]** "This is live on GOAT mainnet, right now. Fifteen contracts, deployed and working. Here
is a real receipt, anchored on-chain — a paid tool call, settled on Bitcoin."

### Scene 4 — The flow running (the money shot)
**[SHOW]** Terminal: run the mainnet demo command. Let the output scroll.
**[SAY]** "Watch the whole flow. The agent asks for a tool, gets a 402, checks its budget, and
pays. The tool runs first — so a failed call is never billed. When a paid tool buys from other
tools, the payments cascade under one budget cap. And an over-budget call is rejected before it
even signs."
**[SHOW]** Refresh the explorer — the receipt count went up.
**[SAY]** "And here they are — new receipts, just now, on GOAT mainnet."

### Scene 5 — Trust layer + close
**[SHOW]** Dashboard → /explorer (reputation + bonds), then /disputes.
**[SAY]** "Every tool builds a reputation from real receipts, stakes a bond, and can be disputed —
a bad call refunds the buyer from that bond. That is the trust and payment layer for the agent
economy. Live on GOAT, settled on Bitcoin."

---

## Notes
- Keep each scene short; the whole thing should land under 3 minutes.
- If you'd rather not run the terminal live, just show the explorer with the receipts already
  anchored (Scene 3 + 4 merge into "here it is, live on mainnet").
- The dashboard currently reads the testnet contracts (richer data — auctions, disputes, bonds
  all exercised). The mainnet proof comes from the explorer. If you want the dashboard itself to
  read mainnet, say the word and it's a quick switch + redeploy.
