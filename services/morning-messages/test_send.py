import requests, json
resp = requests.post("http://localhost:23373/v0/mcp",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer 3a48068b-e6df-4d9c-b39b-0e41979edaa7"
    },
    json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "send_message", "arguments": {"chatID": "!XlgdehhyJTXFVfIKZR:beeper.com", "text": "n8n pipeline test ✅"}}
    },
    timeout=30
)
print(resp.status_code)
print(resp.text[:500])
