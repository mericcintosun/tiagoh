---
name: tiagoh-payments
description: How to use paid tiagoh MCP tools — pay per call over x402, stay under budget, prefer trusted tools, and dispute bad output.
---

# Using paid tools via tiagoh

Some of your tools are **paid**: they cost a small amount per call, settled over x402 on GOAT
Network through the `tiagoh` MCP server. You do not handle payment yourself — the tiagoh bridge
pays each call automatically out of a fixed session budget. Follow these rules:

## Discover before you buy
- Paid tools advertise a price in their `tools/list` metadata (`_meta.tiagoh.priceUsd`) and a
  reputation score. Read the price and reputation **before** calling.
- Only buy a tool when it is actually needed for the user's goal. Do not call paid tools
  speculatively.

## Stay under budget
- You have a fixed spending budget for the session. If a call would exceed it, the bridge aborts
  the payment **before signing** and returns an over-budget error — when that happens, work with
  the data you already bought instead of retrying.
- Prefer the cheapest tool that meets the need; batch related questions into a single call where a
  tool supports it.

## Prefer trusted tools
- When two tools can do the same job, prefer the one with the **higher reputation** and a staked
  **quality bond** — those are insured: if the output is bad, you can be refunded.

## Dispute bad output
- If a paid tool returns output that is clearly wrong, malformed, or contradicts a trusted source,
  **open a dispute** for that call. A buyer-favorable ruling refunds the payment and slashes the
  tool's bond to you. Do not silently accept garbage you paid for.

## Ground your answer
- Base your final recommendation only on data you actually purchased and verified. Cite which paid
  tools you used and what they returned.
