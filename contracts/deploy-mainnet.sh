#!/usr/bin/env bash
# Deploy the tiagoh suite to GOAT MAINNET (chainId 2345).
#
# PREREQUISITES:
#   1. The deployer wallet (PRIVATE_KEY) MUST hold a little BTC on GOAT mainnet for gas.
#      Check:  cast balance <deployer> --rpc-url https://rpc.goat.network
#   2. Set a PAYMENT_TOKEN (a real stablecoin on GOAT mainnet, or a demo ERC20 you deploy first).
#
# GUARDED LAUNCH: pass CHANNEL_DEPOSIT_CAP to bound the PaymentChannel at deploy, and run
# SetLaunchCaps.s.sol afterwards (with the deployed addresses in .env) to cap escrow/cascade.
#
# Usage:
#   bash deploy-mainnet.sh            # deploy the core suite
#   bash deploy-mainnet.sh scaffolds  # deploy the session-key / arbiter / ERC-8004 additions
#   bash deploy-mainnet.sh caps       # set escrow/cascade value caps (addresses must be in .env)
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

RPC="${GOAT_MAINNET_RPC:-https://rpc.goat.network}"
: "${PRIVATE_KEY:?set PRIVATE_KEY in contracts/.env}"

STEP="${1:-core}"
case "$STEP" in
  core)      SCRIPT="script/Deploy.s.sol:Deploy" ;;
  scaffolds) SCRIPT="script/DeployScaffolds.s.sol:DeployScaffolds" ;;
  caps)      SCRIPT="script/SetLaunchCaps.s.sol:SetLaunchCaps" ;;
  *) echo "unknown step: $STEP (use core|scaffolds|caps)"; exit 1 ;;
esac

echo "→ deploying [$STEP] to GOAT mainnet ($RPC)"
forge script "$SCRIPT" \
  --rpc-url "$RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast --slow \
  --priority-gas-price "${PRIORITY_GAS_PRICE:-200000}" \
  --with-gas-price "${MAX_GAS_PRICE:-1000000}" \
  "${@:2}"
