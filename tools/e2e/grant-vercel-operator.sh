#!/bin/zsh
# Vercel submitter'a X402Settler operatör yetkisi verir (timelock üzerinden).
# 11 Ağu 21:46'dan SONRA çalıştır. Öncesinde "not ready" diye reddedilir.
set -e
cd "$(dirname "$0")/../.."
set -a; . contracts/.env; set +a
cast send 0x14a19a0204a789F5fE1Eb498902D02ec5a8C08AB "execute(address,uint256,bytes,bytes32,bytes32)" \
  0x630b7C9D965994A3F2a2254534260A67423B6672 0 0x558a7297000000000000000000000000c9b2dc20a2c66b353feaf9a6c7f16dec1659e1750000000000000000000000000000000000000000000000000000000000000001 0x0000000000000000000000000000000000000000000000000000000000000000 0xa0d313a3d897a8c15e285f1f65e5964baae0c4548f32c2f4f90d3c50bb8f5a20 \
  --rpc-url https://rpc.goat.network --private-key $PRIVATE_KEY --priority-gas-price 200000 --gas-price 1000000
echo "--- doğrulama ---"
cast call 0x630b7C9D965994A3F2a2254534260A67423B6672 "isOperator(address)(bool)" 0xc9B2dC20a2C66B353FEaF9A6c7f16Dec1659E175 --rpc-url https://rpc.goat.network
