#!/usr/bin/env python3
"""Last Rock Dev MCP Server - Full Dev Tools + N8N + Real SSH"""
import asyncio
import json
import os
import subprocess
import uuid
import httpx
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

app = FastAPI(title="Last Rock Dev MCP", version="2.1.0")

# Session management
sessions: dict[str, asyncio.Queue] = {}

# N8N Configuration
from n8n_config import N8N_URL, N8N_API_KEY

# SSH Key from secret
SSH_PRIVATE_KEY = os.environ.get("SSH_PRIVATE_KEY", "")

# Initialize SSH key on startup
def setup_ssh():
    if SSH_PRIVATE_KEY:
        ssh_dir = Path("/root/.ssh")
        ssh_dir.mkdir(mode=0o700, exist_ok=True)
        key_path = ssh_dir / "id_ed25519"
        key_path.write_text(SSH_PRIVATE_KEY)
        key_path.chmod(0o600)
        return True
    return False

SSH_READY = setup_ssh()

# SSH Host Configuration
SSH_HOSTS = {
    "garzahive": {"ip": "192.241.139.240", "user": "root", "desc": "Main GarzaHive VPS (DigitalOcean)"},
    "garzahive-01": {"ip": "192.241.139.240", "user": "root", "desc": "Alias for garzahive"},
    "garza-n8n": {"ip": "146.190.157.249", "user": "root", "desc": "N8N Server"},
    "ssh-bastion": {"ip": "143.198.190.20", "user": "root", "desc": "SSH Bastion/Jump host"},
    "vps": {"ip": "159.89.232.130", "user": "root", "desc": "Legacy VPS"},
}

# Tool definitions
TOOLS = [
    # === Core Tools ===
    {"name": "ping", "description": "Health check - returns server info and timestamp", 
     "inputSchema": {"type": "object", "properties": {}, "required": []}},
    {"name": "get_time", "description": "Get current time in specified timezone",
     "inputSchema": {"type": "object", "properties": {"timezone": {"type": "string", "default": "America/Denver"}}, "required": []}},
    {"name": "server_info", "description": "Get detailed server information",
     "inputSchema": {"type": "object", "properties": {}, "required": []}},
    
    # === SSH Tools ===
    {"name": "ssh_exec", "description": "Execute command on remote host via SSH. Hosts: garzahive, garza-n8n, ssh-bastion, vps",
     "inputSchema": {"type": "object", "properties": {
         "host": {"type": "string", "description": "SSH host alias or IP"},
         "command": {"type": "string", "description": "Command to execute"},
         "user": {"type": "string", "default": "root", "description": "SSH user"},
         "timeout": {"type": "integer", "default": 30, "description": "Timeout in seconds"}
     }, "required": ["host", "command"]}},
    {"name": "ssh_hosts", "description": "List available SSH hosts with details",
     "inputSchema": {"type": "object", "properties": {}, "required": []}},
    {"name": "ssh_test", "description": "Test SSH connectivity to a host",
     "inputSchema": {"type": "object", "properties": {"host": {"type": "string"}}, "required": ["host"]}},
    
    # === Shell Tools ===
    {"name": "shell_exec", "description": "Execute local shell command on this Fly.io container",
     "inputSchema": {"type": "object", "properties": {
         "command": {"type": "string", "description": "Shell command"},
         "timeout": {"type": "integer", "default": 30}
     }, "required": ["command"]}},
    
    # === N8N Tools (GarzaSync Cloud) ===
    {"name": "n8n_list_workflows", "description": "List N8N workflows from GarzaSync Cloud",
     "inputSchema": {"type": "object", "properties": {
         "active": {"type": "boolean"}, "limit": {"type": "integer", "default": 50}
     }, "required": []}},
    {"name": "n8n_get_workflow", "description": "Get workflow details by ID",
     "inputSchema": {"type": "object", "properties": {
         "workflow_id": {"type": "string"}
     }, "required": ["workflow_id"]}},
    {"name": "n8n_activate_workflow", "description": "Activate/deactivate workflow",
     "inputSchema": {"type": "object", "properties": {
         "workflow_id": {"type": "string"}, "active": {"type": "boolean"}
     }, "required": ["workflow_id", "active"]}},
    {"name": "n8n_execute_workflow", "description": "Execute workflow with optional data",
     "inputSchema": {"type": "object", "properties": {
         "workflow_id": {"type": "string"}, "data": {"type": "object", "default": {}}
     }, "required": ["workflow_id"]}},
    {"name": "n8n_get_executions", "description": "Get recent workflow executions",
     "inputSchema": {"type": "object", "properties": {
         "workflow_id": {"type": "string"}, "status": {"type": "string", "enum": ["success", "error", "waiting"]},
         "limit": {"type": "integer", "default": 20}
     }, "required": []}},
    {"name": "n8n_trigger_webhook", "description": "Trigger N8N webhook",
     "inputSchema": {"type": "object", "properties": {
         "webhook_path": {"type": "string"}, "method": {"type": "string", "enum": ["GET", "POST"], "default": "POST"},
         "data": {"type": "object", "default": {}}, "test_mode": {"type": "boolean", "default": False}
     }, "required": ["webhook_path"]}},
]

def get_n8n_config() -> tuple[str, str]:
    """Get N8N GarzaSync Cloud configuration"""
    return N8N_URL, N8N_API_KEY


async def n8n_request(method: str, endpoint: str, data: dict = None) -> dict:
    base_url, api_key = get_n8n_config()
    if not base_url or not api_key:
        return {"error": "N8N not configured"}
    
    url = f"{base_url}/api/v1{endpoint}"
    headers = {"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            if method == "GET":
                resp = await client.get(url, headers=headers)
            elif method == "POST":
                resp = await client.post(url, headers=headers, json=data or {})
            elif method == "PATCH":
                resp = await client.patch(url, headers=headers, json=data or {})
            else:
                return {"error": f"Unsupported method: {method}"}
            
            if resp.status_code >= 400:
                return {"error": f"HTTP {resp.status_code}", "body": resp.text[:500]}
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

def run_ssh(host: str, command: str, user: str = "root", timeout: int = 30) -> dict:
    """Execute SSH command - the real deal"""
    if not SSH_READY:
        return {"error": "SSH key not configured", "hint": "Set SSH_PRIVATE_KEY secret"}
    
    # Resolve host alias
    if host in SSH_HOSTS:
        ip = SSH_HOSTS[host]["ip"]
        user = SSH_HOSTS[host].get("user", user)
    else:
        ip = host  # Assume it's an IP
    
    ssh_cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR", "-o", f"ConnectTimeout={min(timeout, 10)}",
        f"{user}@{ip}", command
    ]
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "host": host,
            "ip": ip,
            "user": user,
            "command": command,
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr if result.returncode != 0 else None
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out", "host": host, "timeout": timeout}
    except Exception as e:
        return {"error": str(e), "host": host}

def run_shell(command: str, timeout: int = 30) -> dict:
    """Execute local shell command"""
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=timeout)
        return {
            "command": command,
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr if result.returncode != 0 else None
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out", "timeout": timeout}
    except Exception as e:
        return {"error": str(e)}

async def execute_tool(name: str, args: dict) -> Any:
    # === Core ===
    if name == "ping":
        return {"status": "ok", "server": "last-rock-dev", "version": "2.1.0",
                "n8n": "garzasync.app.n8n.cloud",
                "region": os.environ.get("FLY_REGION", "local"),
                "ssh_ready": SSH_READY, "timestamp": datetime.now(timezone.utc).isoformat()}
    
    elif name == "get_time":
        tz_name = args.get("timezone", "America/Denver")
        try:
            now = datetime.now(ZoneInfo(tz_name))
            return {"timezone": tz_name, "time": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
                    "iso": now.isoformat(), "unix": int(now.timestamp())}
        except Exception as e:
            return {"error": str(e)}
    
    elif name == "server_info":
        return {"app": "last-rock-dev", "version": "2.1.0",
                "fly_region": os.environ.get("FLY_REGION", "unknown"),
                "fly_machine_id": os.environ.get("FLY_MACHINE_ID", "unknown"),
                "ssh_ready": SSH_READY, "ssh_hosts": list(SSH_HOSTS.keys()),
                "n8n": "garzasync.app.n8n.cloud", "n8n_configured": bool(N8N_API_KEY)}
    
    # === SSH ===
    elif name == "ssh_exec":
        return run_ssh(args["host"], args["command"], args.get("user", "root"), args.get("timeout", 30))
    
    elif name == "ssh_hosts":
        return {"ssh_ready": SSH_READY, "hosts": SSH_HOSTS}
    
    elif name == "ssh_test":
        host = args.get("host", "garzahive")
        return run_ssh(host, "echo 'SSH OK' && hostname && uptime", timeout=10)
    
    # === Shell ===
    elif name == "shell_exec":
        return run_shell(args["command"], args.get("timeout", 30))
    
    # === N8N (GarzaSync Cloud) ===
    elif name == "n8n_list_workflows":
        params = []
        if "active" in args: params.append(f"active={str(args['active']).lower()}")
        if "limit" in args: params.append(f"limit={args['limit']}")
        endpoint = "/workflows" + ("?" + "&".join(params) if params else "")
        return await n8n_request("GET", endpoint)
    
    elif name == "n8n_get_workflow":
        return await n8n_request("GET", f"/workflows/{args['workflow_id']}")
    
    elif name == "n8n_activate_workflow":
        return await n8n_request("PATCH", f"/workflows/{args['workflow_id']}", {"active": args["active"]})
    
    elif name == "n8n_execute_workflow":
        return await n8n_request("POST", f"/workflows/{args['workflow_id']}/run", args.get("data", {}))
    
    elif name == "n8n_get_executions":
        params = []
        if "workflow_id" in args: params.append(f"workflowId={args['workflow_id']}")
        if "status" in args: params.append(f"status={args['status']}")
        if "limit" in args: params.append(f"limit={args['limit']}")
        endpoint = "/executions" + ("?" + "&".join(params) if params else "")
        return await n8n_request("GET", endpoint)
    
    elif name == "n8n_trigger_webhook":
        base_url, _ = get_n8n_config()
        webhook_type = "webhook-test" if args.get("test_mode") else "webhook"
        url = f"{base_url}/{webhook_type}/{args['webhook_path']}"
        
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                if args.get("method", "POST") == "GET":
                    resp = await client.get(url)
                else:
                    resp = await client.post(url, json=args.get("data", {}))
                return {"status_code": resp.status_code, "response": resp.text[:1000]}
            except Exception as e:
                return {"error": str(e)}
    
    return {"error": f"Unknown tool: {name}"}

def handle_jsonrpc(request: dict) -> dict:
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})
    
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": req_id, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"listChanged": True}},
            "serverInfo": {"name": "last-rock-dev", "version": "2.1.0"}
        }}
    elif method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}
    elif method == "tools/call":
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(execute_tool(params.get("name", ""), params.get("arguments", {})))
        loop.close()
        return {"jsonrpc": "2.0", "id": req_id, "result": {
            "content": [{"type": "text", "text": json.dumps(result, indent=2)}]
        }}
    elif method == "notifications/initialized":
        return None
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "2.1.0", "ssh_ready": SSH_READY,
            "n8n": "garzasync.app.n8n.cloud", "region": os.environ.get("FLY_REGION", "local")}

@app.get("/sse")
@app.post("/sse")
async def sse_endpoint(request: Request):
    session_id = str(uuid.uuid4())
    sessions[session_id] = asyncio.Queue()
    
    async def event_generator():
        yield {"event": "endpoint", "data": f"/message?session_id={session_id}"}
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(sessions[session_id].get(), timeout=30)
                    yield {"event": "message", "data": json.dumps(msg)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "keepalive"}
        except asyncio.CancelledError:
            pass
        finally:
            sessions.pop(session_id, None)
    
    return EventSourceResponse(event_generator())

@app.post("/message")
async def message_endpoint(request: Request):
    session_id = request.query_params.get("session_id")
    if not session_id or session_id not in sessions:
        return JSONResponse({"error": "Invalid session"}, status_code=400)
    
    body = await request.json()
    response = handle_jsonrpc(body)
    if response:
        await sessions[session_id].put(response)
    return JSONResponse({"status": "ok"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
