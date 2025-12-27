#!/usr/bin/env python3
"""
Beeper Notification Helper
Sends notifications to Beeper when operations complete
"""
import os
import sys
import json
import requests
from datetime import datetime


def send_beeper_notification(
    message: str,
    priority: str = "normal",
    chat_id: str = None,
    metadata: dict = None
):
    """
    Send notification to Beeper via MCP or direct API
    
    Args:
        message: Notification message
        priority: high, normal, low
        chat_id: Optional specific chat ID
        metadata: Additional context
    """
    
    # Load Beeper chat IDs from environment or config
    default_chat = os.getenv('BEEPER_NOTIFICATIONS_CHAT_ID', 'YOUR_CHAT_ID')
    target_chat = chat_id or default_chat
    
    # Format message with metadata
    if metadata:
        message += "\n\n**Details:**"
        for key, value in metadata.items():
            message += f"\n• {key}: {value}"
    
    # Add timestamp
    timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    message += f"\n\n_Generated: {timestamp}_"
    
    # Priority emoji
    priority_emoji = {
        'high': '🚨',
        'normal': 'ℹ️',
        'low': '📝'
    }
    emoji = priority_emoji.get(priority, 'ℹ️')
    
    formatted_message = f"{emoji} **GARZA OS**\n\n{message}"
    
    # Try to send via Beeper API
    # For now, just print (will integrate with MCP later)
    print(f"[BEEPER] Would send to {target_chat}:")
    print(formatted_message)
    print()
    
    # TODO: Integrate with Beeper MCP when available
    # For GitHub Actions, we could use a webhook or API endpoint
    
    return True


def notify_operation_complete(
    operation_type: str,
    target: str,
    status: str,
    duration_seconds: float = None,
    error: str = None
):
    """Notify about completed operation"""
    
    status_emoji = "✅" if status == "success" else "❌"
    
    message = f"{status_emoji} **{operation_type.upper()}**\n"
    message += f"Target: `{target}`\n"
    message += f"Status: {status}"
    
    metadata = {}
    
    if duration_seconds:
        metadata['Duration'] = f"{duration_seconds:.1f}s"
    
    if error:
        metadata['Error'] = error
    
    priority = "high" if status == "failure" else "normal"
    
    return send_beeper_notification(message, priority=priority, metadata=metadata)


def notify_health_check(service_group: str, results: dict):
    """Notify about health check results"""
    
    total = results.get('total', 0)
    healthy = results.get('healthy', 0)
    unhealthy = results.get('unhealthy', 0)
    
    if unhealthy > 0:
        message = f"⚠️ **HEALTH CHECK ALERT**\n"
        message += f"Group: `{service_group}`\n"
        message += f"Healthy: {healthy}/{total}\n"
        message += f"Unhealthy: {unhealthy}"
        
        metadata = {}
        if 'unhealthy_services' in results:
            metadata['Unhealthy Services'] = ', '.join(results['unhealthy_services'])
        
        return send_beeper_notification(message, priority="high", metadata=metadata)
    else:
        # Only notify on all healthy if it's a recovery
        if results.get('recovered', False):
            message = f"✅ **RECOVERY COMPLETE**\n"
            message += f"Group: `{service_group}`\n"
            message += f"All services healthy: {healthy}/{total}"
            
            return send_beeper_notification(message, priority="normal")
    
    return True


def notify_auto_recovery(
    recovery_type: str,
    target: str,
    status: str,
    actions_taken: list = None
):
    """Notify about auto-recovery attempt"""
    
    status_emoji = "✅" if status == "success" else "❌"
    
    message = f"{status_emoji} **AUTO-RECOVERY**\n"
    message += f"Type: `{recovery_type}`\n"
    message += f"Target: `{target}`\n"
    message += f"Status: {status}"
    
    metadata = {}
    if actions_taken:
        metadata['Actions'] = ', '.join(actions_taken)
    
    priority = "high" if status == "failure" else "normal"
    
    return send_beeper_notification(message, priority=priority, metadata=metadata)


def main():
    """CLI interface"""
    if len(sys.argv) < 2:
        print("Usage: python notify.py <type> [args...]")
        print("\nTypes:")
        print("  operation <operation_type> <target> <status> [duration] [error]")
        print("  health <service_group> <results_json>")
        print("  recovery <recovery_type> <target> <status> [actions_json]")
        print("  message <message> [priority]")
        sys.exit(1)
    
    notification_type = sys.argv[1]
    
    if notification_type == 'operation':
        if len(sys.argv) < 5:
            print("Error: operation requires operation_type, target, status")
            sys.exit(1)
        
        operation_type = sys.argv[2]
        target = sys.argv[3]
        status = sys.argv[4]
        duration = float(sys.argv[5]) if len(sys.argv) > 5 else None
        error = sys.argv[6] if len(sys.argv) > 6 else None
        
        notify_operation_complete(operation_type, target, status, duration, error)
    
    elif notification_type == 'health':
        if len(sys.argv) < 4:
            print("Error: health requires service_group, results_json")
            sys.exit(1)
        
        service_group = sys.argv[2]
        results = json.loads(sys.argv[3])
        
        notify_health_check(service_group, results)
    
    elif notification_type == 'recovery':
        if len(sys.argv) < 5:
            print("Error: recovery requires recovery_type, target, status")
            sys.exit(1)
        
        recovery_type = sys.argv[2]
        target = sys.argv[3]
        status = sys.argv[4]
        actions = json.loads(sys.argv[5]) if len(sys.argv) > 5 else None
        
        notify_auto_recovery(recovery_type, target, status, actions)
    
    elif notification_type == 'message':
        if len(sys.argv) < 3:
            print("Error: message requires message text")
            sys.exit(1)
        
        message = sys.argv[2]
        priority = sys.argv[3] if len(sys.argv) > 3 else "normal"
        
        send_beeper_notification(message, priority=priority)
    
    else:
        print(f"Unknown notification type: {notification_type}")
        sys.exit(1)


if __name__ == '__main__':
    main()
