#!/usr/bin/env bash
#
# tiagoh — contract dependency bootstrap.
#
# lib/ is gitignored, so this script (re)clones the three Solidity deps that the
# Foundry project builds against. It is idempotent: an existing, non-empty lib
# dir is left untouched.
#
#   - forge-std                (Foundry test/script stdlib)
#   - OpenZeppelin/contracts   (v5 — Ownable(initialOwner), SafeERC20, ECDSA, …)
#   - erc-8004/erc-8004-contracts (canonical Identity/Reputation/Validation registries)
#
# Usage:  bash setup-deps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"
mkdir -p "${LIB_DIR}"

clone_dep() {
  local name="$1" url="$2" ref="${3:-}"
  local dest="${LIB_DIR}/${name}"
  if [ -d "${dest}" ] && [ -n "$(ls -A "${dest}" 2>/dev/null)" ]; then
    echo "==> ${name}: already present, skipping"
    return 0
  fi
  echo "==> ${name}: cloning ${url}"
  if [ -n "${ref}" ]; then
    git clone --depth 1 --branch "${ref}" "${url}" "${dest}"
  else
    git clone --depth 1 "${url}" "${dest}"
  fi
}

clone_dep "forge-std"            "https://github.com/foundry-rs/forge-std"
clone_dep "openzeppelin-contracts" "https://github.com/OpenZeppelin/openzeppelin-contracts"
clone_dep "erc-8004"             "https://github.com/erc-8004/erc-8004-contracts"

echo ""
echo "All dependencies present in ${LIB_DIR}."
echo "Next:  forge build  &&  forge test"
