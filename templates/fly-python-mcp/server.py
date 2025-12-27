"""
GARZA OS - Base Python MCP Server Template
Copy this and customize for new MCP servers
"""

import os
import json
import uuid
import asyncio
from datetime import datetime
from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

API_KEY = os.getenv("API_KEY", "change-me-in-production")
sessions = {}

# =============================================================================
# AUTH
# =============================================================================
def check_auth(key: str = Query(None), request: Request = None):
    header_key = request.headers.get("x-api-key") if request else None
    if (key or header_key) != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

# =============================================================================
# HEALTH
# =============================================================================
@app.get("/health")
async def health():
    return {"status": "ok", "server": "your-mcp-name", "timestamp": datetime.utcnow().isoformat()}

# =============================================================================
# SSE ENDPOINT
# =============================================================================
@app.get("/sse")
async def sse(key: str = Query(...), request: Request = None):
    check_auth(key, request)
    session_id = str(uuid.uuid4())
    sessions[session_id] = {"created": datetime.utcnow()}
    
    async def event_stream():
        yield f"data: /messages?sessionId={session_id}&key={key}\n\n"
        try:
            while True:
                yield ": keepalive\n\n"
                await asyncio.sleep(30)
        except asyncio.CancelledError:
            sessions.pop(session_id, None)
    
    return StreamingResponse(event_stream(), media_type="text/event-stream")

# =============================================================================
# MESSAGES ENDPOINT
# =============================================================================
@app.post("/messages")
async def messages(request: Request, key: str = Query(...)):
    check_auth(key, request)
    body = await request.json()
    method = body.get("method")
    params = body.get("params", {})
    req_id = body.get("id")
    
    try:
        if method == "initialize":
            result = {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "your-mcp-name", "version": "1.0.0"},
                "capabilities": {"tools": {}}
            }
        elif method == "tools/list":
            result = {"tools": get_tool_definitions()}
        elif method == "tools/call":
            result = await handle_tool_call(params.get("name"), params.get("arguments", {}))
        else:
            result = {}
        
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -1, "message": str(e)}}

# =============================================================================
# TOOL DEFINITIONS - CUSTOMIZE THESE
# =============================================================================
def get_tool_definitions():
    return [
        {
            "name": "ping",
            "description": "Health check",
            "inputSchema": {"type": "object", "properties": {}, "required": []}
        },
        # ADD YOUR TOOLS HERE
    ]

# =============================================================================
# TOOL HANDLERS - CUSTOMIZE THESE
# =============================================================================
async def handle_tool_call(name: str, args: dict):
    if name == "ping":
        return {"content": [{"type": "text", "text": json.dumps({"status": "pong", "timestamp": datetime.utcnow().isoformat()})}]}
    
    # ADD YOUR HANDLERS HERE
    
    raise ValueError(f"Unknown tool: {name}")

# =============================================================================
# RUN
# =============================================================================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
