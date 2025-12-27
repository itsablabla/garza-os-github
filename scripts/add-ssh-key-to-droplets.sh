#!/bin/bash
# Run this script from a machine that has SSH access to DO droplets
# It will add Jaden's new SSH key to all servers

JADEN_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP+Uc8k/sxsNqX6lwJklWCcIfwyAe9IN/yHY3sJv8iv0 jaden@lastrocklabs.com"

SERVERS=(
  "root@206.189.203.81"   # oasis
  "root@104.248.233.116"  # oasis-staging
  "root@167.99.145.135"   # assets
  "root@68.183.135.130"   # assets-staging
  "root@157.230.48.158"   # lrlos
  "root@147.182.164.112"  # fwa-api
  "root@143.244.167.105"  # fwa-api-staging
  "root@157.230.182.134"  # fwaexchange
  "root@67.205.137.64"    # fwa-staging
  "root@143.198.228.240"  # paynomad
  "root@159.223.198.166"  # nomadpays
  "root@178.128.11.130"   # nomadpay-staging
  "root@167.172.205.177"  # docker-sfo
)

for server in "${SERVERS[@]}"; do
  echo "Adding key to $server..."
  ssh -o StrictHostKeyChecking=accept-new "$server" "mkdir -p ~/.ssh && echo '$JADEN_KEY' >> ~/.ssh/authorized_keys && echo 'Done!'" 2>&1
done
