#!/bin/bash
# Claude Desktop Remote Control Script

ACTION="${1:-status}"
MESSAGE="${2:-}"
THIRD="${3:-}"

case "$ACTION" in
  status)
    osascript -e 'tell application "System Events" to return (name of processes) contains "Claude"'
    ;;
  
  open)
    osascript -e 'tell application "Claude" to activate'
    echo "Claude Desktop activated"
    ;;
  
  quit)
    osascript -e 'tell application "Claude" to quit'
    echo "Claude Desktop quit"
    ;;
  
  new)
    osascript -e 'tell application "Claude" to activate' -e 'delay 0.5' -e 'tell application "System Events" to keystroke "n" using command down'
    echo "New conversation started"
    ;;

  switch-chat)
    if [ -z "$MESSAGE" ]; then
      echo "Error: No chat name provided"
      exit 1
    fi
    osascript << EOA
      tell application "Claude" to activate
      delay 0.3
      tell application "System Events"
        keystroke "k" using command down
        delay 0.5
        keystroke "$MESSAGE"
        delay 0.5
        keystroke return
        delay 0.3
      end tell
EOA
    echo "Switched to chat: $MESSAGE"
    ;;
  
  full-send)
    echo -n "$MESSAGE" | pbcopy
    osascript << EOA
      tell application "Claude" to activate
      delay 0.5
      tell application "System Events"
        keystroke "v" using command down
        delay 0.3
        keystroke return using command down
      end tell
EOA
    echo "Full send complete"
    ;;

  switch-and-send)
    CHAT_NAME="$MESSAGE"
    MSG="$THIRD"
    if [ -z "$CHAT_NAME" ] || [ -z "$MSG" ]; then
      echo "Error: Usage: switch-and-send 'chat-name' 'message'"
      exit 1
    fi
    echo -n "$MSG" | pbcopy
    osascript << EOA
      tell application "Claude" to activate
      delay 0.3
      tell application "System Events"
        keystroke "k" using command down
        delay 0.5
        keystroke "$CHAT_NAME"
        delay 0.5
        keystroke return
        delay 0.5
        keystroke "v" using command down
        delay 0.3
        keystroke return using command down
      end tell
EOA
    echo "Switched to '$CHAT_NAME' and sent message"
    ;;

  screenshot)
    FILENAME="/tmp/claude-screenshot-$(date +%s).png"
    osascript -e 'tell application "Claude" to activate'
    sleep 0.5
    screencapture -l$(osascript -e 'tell app "Claude" to id of window 1' 2>/dev/null) "$FILENAME" 2>/dev/null || screencapture -w "$FILENAME" 2>/dev/null
    if [ -f "$FILENAME" ]; then
      echo "$FILENAME"
    else
      echo "ERROR: Screen recording permission required"
    fi
    ;;

  get-screenshot)
    FILENAME="/tmp/claude-screenshot-$(date +%s).png"
    osascript -e 'tell application "Claude" to activate'
    sleep 0.5
    screencapture -l$(osascript -e 'tell app "Claude" to id of window 1' 2>/dev/null) "$FILENAME" 2>/dev/null || screencapture -w "$FILENAME" 2>/dev/null
    if [ -f "$FILENAME" ] && [ -s "$FILENAME" ]; then
      base64 -i "$FILENAME"
    else
      echo ""
    fi
    ;;

  copy-response)
    # Try to copy Claude's last response using keyboard
    osascript << 'EOA'
      tell application "Claude" to activate
      delay 0.3
      tell application "System Events"
        -- Use Option+Click or find copy button - this is app-specific
        -- Trying keyboard shortcut that might work
        key code 8 using {command down, shift down}
        delay 0.2
      end tell
      return (the clipboard)
EOA
    ;;
    
  *)
    echo "Usage: claude-remote.sh [status|open|quit|new|switch-chat|full-send|switch-and-send|screenshot|get-screenshot|copy-response] [args]"
    exit 1
    ;;
esac
