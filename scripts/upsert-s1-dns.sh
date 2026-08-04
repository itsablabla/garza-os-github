#!/usr/bin/env bash
set -euo pipefail
ZONE_ID=9c70206ce57d506d1d4e9397f6bb8ebc
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"

if [[ -n "${TOKEN}" ]]; then
  echo "auth=bearer"
  auth_curl() { curl -sS -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" "$@"; }
elif [[ -n "${CF_API_KEY:-}" ]]; then
  echo "auth=global-key"
  EMAIL="${CF_EMAIL:-jadengarza@pm.me}"
  auth_curl() { curl -sS -H "X-Auth-Email: ${EMAIL}" -H "X-Auth-Key: ${CF_API_KEY}" -H "Content-Type: application/json" "$@"; }
else
  echo "No Cloudflare credentials available in environment"
  exit 1
fi

upsert() {
  local TYPE="$1" NAME="$2" CONTENT="$3"
  echo "Upserting ${TYPE} ${NAME} -> ${CONTENT}"
  local LIST RID BODY RESP
  LIST=$(auth_curl "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=${TYPE}&name=${NAME}")
  echo "$LIST" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("list_success",d.get("success"),"count",len(d.get("result") or []),"errors",d.get("errors"))'
  RID=$(echo "$LIST" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("result") or [];print(r[0]["id"] if r else "")')
  BODY=$(TYPE="$TYPE" NAME="$NAME" CONTENT="$CONTENT" python3 - <<'PY'
import json, os
print(json.dumps({
  "type": os.environ["TYPE"],
  "name": os.environ["NAME"],
  "content": os.environ["CONTENT"],
  "ttl": 1,
  "proxied": False,
}))
PY
)
  if [[ -n "$RID" ]]; then
    RESP=$(auth_curl -X PUT --data "$BODY" "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RID}")
  else
    RESP=$(auth_curl -X POST --data "$BODY" "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records")
  fi
  echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps(d,indent=2)[:1000]); raise SystemExit(0 if d.get("success") else 1)'
}

upsert A s1.garzahive.com 169.58.128.183
upsert AAAA s1.garzahive.com 2a02:c207:2348:7782::1
echo DONE
