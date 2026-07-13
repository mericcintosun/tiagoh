#!/usr/bin/env bash
# Deploy the tiagoh suite to GOAT testnet.
#
# GOAT Testnet3 enforces a minimum gas tip (maxPriorityFeePerGas >= 130000 wei);
# forge's auto-estimate underprices it and the broadcast fails with
# "transaction gas price below minimum". These flags bake in a safe floor.
# Override via env: PRIORITY_GAS_PRICE / MAX_GAS_PRICE (wei).
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
: "${GOAT_RPC:?set GOAT_RPC in contracts/.env}"
: "${PRIVATE_KEY:?set PRIVATE_KEY in contracts/.env}"

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$GOAT_RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast --slow \
  --priority-gas-price "${PRIORITY_GAS_PRICE:-200000}" \
  --with-gas-price "${MAX_GAS_PRICE:-1000000}" \
  "$@"
