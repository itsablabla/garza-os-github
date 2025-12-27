#!/usr/bin/env python3
"""Abode MCP HTTP Proxy Server - Multi-account support"""

import asyncio
import json
import logging
from aiohttp import web
from jaraco.abode import Client
from jaraco.abode.helpers import timeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Account credentials
ACCOUNTS = {
    "boulder": {
        "username": "thegarzas@pm.me",
        "password": "hekcYs-jusqoh-8hytdy"
    },
    "office1": {
        "username": "jappajaga@protonmail.com",
        "password": "Hswna1)-yah&@91"
    },
    "office2": {
        "username": "jappajaga@protonmail.ch",
        "password": "Hswna1)-yah&@91"
    }
}

# Cache abode clients
_clients = {}

def get_client(account="boulder"):
    """Get or create Abode client for account"""
    if account not in _clients:
        if account not in ACCOUNTS:
            raise ValueError(f"Unknown account: {account}. Available: {list(ACCOUNTS.keys())}")
        creds = ACCOUNTS[account]
        _clients[account] = Client(
            username=creds["username"],
            password=creds["password"],
            auto_login=True,
            get_devices=True,
            get_automations=True
        )
        logger.info(f"Created Abode client for account: {account}")
    return _clients[account]

def serialize_device(device):
    """Convert device to JSON-serializable dict"""
    return {
        "id": device.device_id,
        "name": device.name,
        "type": device.type,
        "type_tag": device.type_tag,
        "status": device.status,
        "battery_low": getattr(device, 'battery_low', None),
        "no_response": getattr(device, 'no_response', None),
        "tampered": getattr(device, 'tampered', None),
        "desc": device.desc if hasattr(device, 'desc') else str(device),
    }

def serialize_automation(automation):
    """Convert automation to JSON-serializable dict"""
    return {
        "id": automation.automation_id,
        "name": automation.name,
        "enabled": automation.is_enabled,
        "type": getattr(automation, 'type', None),
    }

# API Handlers
async def health(request):
    return web.json_response({
        "status": "ok",
        "service": "abode-proxy",
        "accounts": list(ACCOUNTS.keys())
    })

async def get_mode(request):
    """Get current alarm mode"""
    try:
        data = await request.json() if request.body_exists else {}
        account = data.get("account", "boulder")
        client = get_client(account)
        mode = client.get_alarm().mode
        return web.json_response({"mode": mode, "account": account})
    except Exception as e:
        logger.error(f"get_mode error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def set_mode(request):
    """Set alarm mode (standby, home, away)"""
    try:
        data = await request.json()
        account = data.get("account", "boulder")
        mode = data.get("mode", "standby")
        client = get_client(account)
        alarm = client.get_alarm()
        
        if mode == "standby":
            alarm.set_standby()
        elif mode == "home":
            alarm.set_home()
        elif mode == "away":
            alarm.set_away()
        else:
            return web.json_response({"error": f"Invalid mode: {mode}"}, status=400)
        
        return web.json_response({"success": True, "mode": mode, "account": account})
    except Exception as e:
        logger.error(f"set_mode error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def list_devices(request):
    """List all devices"""
    try:
        data = await request.json() if request.body_exists else {}
        account = data.get("account", "boulder")
        client = get_client(account)
        devices = [serialize_device(d) for d in client.get_devices()]
        return web.json_response({"devices": devices, "count": len(devices), "account": account})
    except Exception as e:
        logger.error(f"list_devices error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def get_device(request):
    """Get specific device by ID"""
    try:
        data = await request.json()
        account = data.get("account", "boulder")
        device_id = data.get("device_id")
        if not device_id:
            return web.json_response({"error": "device_id required"}, status=400)
        
        client = get_client(account)
        device = client.get_device(device_id)
        if not device:
            return web.json_response({"error": f"Device not found: {device_id}"}, status=404)
        
        return web.json_response({"device": serialize_device(device), "account": account})
    except Exception as e:
        logger.error(f"get_device error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def switch_device(request):
    """Turn device on/off"""
    try:
        data = await request.json()
        account = data.get("account", "boulder")
        device_id = data.get("device_id")
        on = data.get("on", True)
        
        if not device_id:
            return web.json_response({"error": "device_id required"}, status=400)
        
        client = get_client(account)
        device = client.get_device(device_id)
        if not device:
            return web.json_response({"error": f"Device not found: {device_id}"}, status=404)
        
        if on:
            device.switch_on()
        else:
            device.switch_off()
        
        return web.json_response({"success": True, "device_id": device_id, "on": on, "account": account})
    except Exception as e:
        logger.error(f"switch_device error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def lock_device(request):
    """Lock/unlock device"""
    try:
        data = await request.json()
        account = data.get("account", "boulder")
        device_id = data.get("device_id")
        lock = data.get("lock", True)
        
        if not device_id:
            return web.json_response({"error": "device_id required"}, status=400)
        
        client = get_client(account)
        device = client.get_device(device_id)
        if not device:
            return web.json_response({"error": f"Device not found: {device_id}"}, status=404)
        
        if lock:
            device.lock()
        else:
            device.unlock()
        
        return web.json_response({"success": True, "device_id": device_id, "locked": lock, "account": account})
    except Exception as e:
        logger.error(f"lock_device error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def list_automations(request):
    """List all automations"""
    try:
        data = await request.json() if request.body_exists else {}
        account = data.get("account", "boulder")
        client = get_client(account)
        automations = [serialize_automation(a) for a in client.get_automations()]
        return web.json_response({"automations": automations, "count": len(automations), "account": account})
    except Exception as e:
        logger.error(f"list_automations error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def trigger_automation(request):
    """Trigger an automation"""
    try:
        data = await request.json()
        account = data.get("account", "boulder")
        automation_id = data.get("automation_id")
        
        if not automation_id:
            return web.json_response({"error": "automation_id required"}, status=400)
        
        client = get_client(account)
        automation = client.get_automation(automation_id)
        if not automation:
            return web.json_response({"error": f"Automation not found: {automation_id}"}, status=404)
        
        automation.trigger()
        return web.json_response({"success": True, "automation_id": automation_id, "account": account})
    except Exception as e:
        logger.error(f"trigger_automation error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def get_settings(request):
    """Get panel settings"""
    try:
        data = await request.json() if request.body_exists else {}
        account = data.get("account", "boulder")
        client = get_client(account)
        settings = client.get_settings()
        return web.json_response({"settings": settings, "account": account})
    except Exception as e:
        logger.error(f"get_settings error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def get_timeline(request):
    """Get recent timeline/activity events"""
    try:
        data = await request.json() if request.body_exists else {}
        account = data.get("account", "boulder")
        limit = data.get("limit", 50)
        
        client = get_client(account)
        events = timeline.get_timeline(client, limit=limit)
        
        # Serialize events
        serialized = []
        for event in events:
            serialized.append({
                "id": getattr(event, 'id', None),
                "event_type": getattr(event, 'event_type', None),
                "event_code": getattr(event, 'event_code', None),
                "device_name": getattr(event, 'device_name', None),
                "device_type": getattr(event, 'device_type', None),
                "date": str(getattr(event, 'date', '')),
                "time": str(getattr(event, 'time', '')),
                "user_name": getattr(event, 'user_name', None),
            })
        
        return web.json_response({"events": serialized, "count": len(serialized), "account": account})
    except Exception as e:
        logger.error(f"get_timeline error: {e}")
        return web.json_response({"error": str(e)}, status=500)

# Auth middleware
API_KEY = "abode-proxy-key-2024"

@web.middleware
async def auth_middleware(request, handler):
    if request.path == "/health":
        return await handler(request)
    
    api_key = request.headers.get("X-API-Key")
    if api_key != API_KEY:
        return web.json_response({"error": "Unauthorized"}, status=401)
    
    return await handler(request)

# App setup
app = web.Application(middlewares=[auth_middleware])
app.router.add_get("/health", health)
app.router.add_post("/api/get_mode", get_mode)
app.router.add_post("/api/set_mode", set_mode)
app.router.add_post("/api/list_devices", list_devices)
app.router.add_post("/api/get_device", get_device)
app.router.add_post("/api/switch_device", switch_device)
app.router.add_post("/api/lock_device", lock_device)
app.router.add_post("/api/list_automations", list_automations)
app.router.add_post("/api/trigger_automation", trigger_automation)
app.router.add_post("/api/get_settings", get_settings)
app.router.add_post("/api/get_timeline", get_timeline)

if __name__ == "__main__":
    logger.info("Starting Abode Proxy on port 3457")
    web.run_app(app, host="127.0.0.1", port=3457)
