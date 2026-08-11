#!/bin/zsh
# tiagoh daemon launcher.
#
# Exists because the daemon needs to outlive the shell that starts it. Anything spawned from an
# interactive session dies with that session, and "the counter goes up" is a promise measured in
# days — L2 grant programmes gate on ≥10 *distinct active days*, so surviving a closed terminal is
# the whole requirement, not a nicety.
#
# Secrets stay in contracts/.env and are sourced here rather than written into the LaunchAgent
# plist, which would put private keys in a world-readable file under ~/Library.
#
# Run directly:   ./tools/e2e/daemon.sh
# Run forever:    see com.tiagoh.daemon.plist next to this file.

set -e
cd "$(dirname "$0")/../.."

set -a
[ -f contracts/.env ] && . contracts/.env
set +a

# Mainnet, always. The chain id is part of the EIP-712 domain every payment is signed under, so a
# stale testnet value here produces valid signatures for the wrong chain — @tiagoh/goat now
# refuses to sign on a mismatch rather than failing mysteriously later.
export GOAT_CHAIN_ID="${GOAT_CHAIN_ID:-2345}"
export GOAT_RPC_URL="${GOAT_RPC_URL:-https://rpc.goat.network}"
export RECEIPT_REGISTRY_ADDRESS="${RECEIPT_REGISTRY_ADDRESS:-0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112}"
export X402_SETTLER_ADDRESS="${X402_SETTLER_ADDRESS:-0x630b7C9D965994A3F2a2254534260A67423B6672}"

# Pace the spend so a small balance lasts weeks instead of hours.
export DAEMON_DAILY_BUDGET_USD="${DAEMON_DAILY_BUDGET_USD:-0.08}"
export DAEMON_INTERVAL_SEC="${DAEMON_INTERVAL_SEC:-1800}"

exec pnpm --filter @tiagoh/e2e daemon
