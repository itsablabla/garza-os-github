#!/usr/bin/env bash
set -euo pipefail
TOKEN="${CLOUDFLARE_API_TOKEN:-}"
export CLOUDFLARE_API_TOKEN="$TOKEN"
[[ -n "$TOKEN" ]] || { echo "no token"; exit 1; }
auth() { curl -sS -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" "$@"; }
ZONE_ID=9c70206ce57d506d1d4e9397f6bb8ebc
IP=169.58.128.183
IP6=2a02:c207:2348:7782::1

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
  echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("success"), d.get("errors"), (d.get("result") or {}).get("name"), (d.get("result") or {}).get("content")); raise SystemExit(0 if d.get("success") else 1)'
}

# delete conflicting CNAMEs for these names
python3 - <<'PY'
import json,os,urllib.request
token=os.environ["CLOUDFLARE_API_TOKEN"]; zone="9c70206ce57d506d1d4e9397f6bb8ebc"
for name in ["coolify.garzahive.com","*.garzahive.com"]:
  req=urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{zone}/dns_records?name={name}",
    headers={"Authorization":f"Bearer {token}"})
  with urllib.request.urlopen(req) as r: d=json.load(r)
  for rec in d.get("result") or []:
    if rec.get("type") in ("CNAME",) or rec.get("proxied") or (rec.get("type")=="A" and rec.get("content")!="169.58.128.183"):
      rid=rec["id"]; print("delete", name, rec["type"], rec.get("content"))
      req=urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{zone}/dns_records/{rid}", method="DELETE",
        headers={"Authorization":f"Bearer {token}"})
      with urllib.request.urlopen(req) as r: print(r.read().decode()[:120])
PY

upsert A coolify.garzahive.com "$IP"
upsert AAAA coolify.garzahive.com "$IP6" || true
# wildcard A/AAAA
upsert A '*.garzahive.com' "$IP"
upsert AAAA '*.garzahive.com' "$IP6" || true
echo DONE
