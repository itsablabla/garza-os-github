#!/usr/bin/env bash
set -euo pipefail
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
if [[ -z "${TOKEN}" ]]; then echo "no token"; exit 1; fi
auth() { curl -sS -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" "$@"; }
# find zone
ZONES=$(auth "https://api.cloudflare.com/client/v4/zones?name=garza.online")
echo "$ZONES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("zones_ok",d.get("success"),[z["id"] for z in d.get("result") or []])'
ZONE_ID=$(echo "$ZONES" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("result") or [];print(r[0]["id"] if r else "")')
[[ -n "$ZONE_ID" ]] || { echo "no zone"; exit 1; }
upsert() {
  local TYPE="$1" NAME="$2" CONTENT="$3"
  echo "Upsert $TYPE $NAME -> $CONTENT"
  LIST=$(auth "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=${TYPE}&name=${NAME}")
  RID=$(echo "$LIST" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("result") or [];print(r[0]["id"] if r else "")')
  BODY=$(TYPE="$TYPE" NAME="$NAME" CONTENT="$CONTENT" python3 - <<'PY'
import json,os
print(json.dumps({"type":os.environ["TYPE"],"name":os.environ["NAME"],"content":os.environ["CONTENT"],"ttl":1,"proxied":False}))
PY
)
  if [[ -n "$RID" ]]; then
    RESP=$(auth -X PUT --data "$BODY" "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RID}")
  else
    RESP=$(auth -X POST --data "$BODY" "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records")
  fi
  echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("success"), d.get("errors"), (d.get("result") or {}).get("content")); raise SystemExit(0 if d.get("success") else 1)'
}
upsert A mcp.garza.online 169.58.128.183
# optional AAAA
upsert AAAA mcp.garza.online 2a02:c207:2348:7782::1 || true
echo DONE
