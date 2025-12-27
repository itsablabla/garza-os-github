# ProtonMail Bridge MCP Server

**Encrypted email search, read, and send capabilities for Claude Desktop**

## ✅ Installation Status

### Completed Automatically:
- ✅ ProtonMail Bridge app installed
- ✅ Server code created ()
- ✅ Python 3.12 installer downloaded and opened
- ✅ Background watcher monitoring Python installation
- ✅ Setup scripts ready

### Pending (2 minutes):
1. **Complete Python 3.12 Installation** (if not done)
   - Click through the installer on your screen
   - Enter password when prompted

2. **Get Bridge Password**
   - Run: 
   - Follow prompts to enter Bridge password

3. **Restart Claude Desktop**
   - Quit (Cmd+Q)
   - Reopen
   - Test: "Search my ProtonMail"

---

## 🚀 Quick Start

### If Python 3.12 is Already Installed:


### To Check Auto-Setup Progress:


### Manual Setup (if needed):


---

## 📧 Available Tools

### 1. **search_protonmail**
Search emails using IMAP queries:



**Parameters:**
- : IMAP search query (default: "ALL")
- : Mailbox to search (default: "INBOX")
- : Max results (default: 10)

### 2. **read_protonmail**
Read full email by ID from search results.

**Parameters:**
- : ID from search results (required)
- : Mailbox (default: "INBOX")

### 3. **send_protonmail**
Send email via ProtonMail SMTP.

**Parameters:**
- : Recipient email (required)
- : Email subject (required)
- : Email body (required)
- : CC recipients (optional)
- : BCC recipients (optional)

---

## 🔧 Configuration

### Bridge Connection
- **IMAP:** 127.0.0.1:1143
- **SMTP:** 127.0.0.1:1025
- **Email:** jadengarza@pm.me

### Files


### Claude Desktop Config
Location: 



---

## 🧪 Testing

After restart, test with:


---

## ❓ Troubleshooting

### ProtonMail Bridge Not Running


### Check Bridge Status
Bridge should show:
- ✅ Connected
- ✅ Email: jadengarza@pm.me
- ✅ IMAP/SMTP ports listening

### MCP Server Logs


### Python Version


### Reset Everything


---

## 🎯 Integration with GARZA OS

Once working, ProtonMail integrates with:
- **Craft**: Store important emails automatically
- **Graphiti**: Learn from email patterns
- **Beeper**: Unified messaging with email
- **Calendar**: Email-based event creation

---

## 📚 IMAP Search Reference

### Common Queries
| Query | Description |
|-------|-------------|
|  | All emails |
|  | From specific sender |
|  | To specific recipient |
|  | Subject contains keyword |
|  | Body contains keyword |
|  | Since date |
|  | Before date |
|  | Read emails |
|  | Unread emails |
|  | Starred emails |

### Combining Queries
Use space-separated queries (AND logic):


---

## 🔐 Security

- ✅ Bridge password stored locally only
- ✅ All email communication encrypted via Bridge
- ✅ No API keys or external authentication
- ✅ Local IMAP/SMTP (127.0.0.1)
- ✅ ProtonMail handles all encryption

---

**Created:** 2025-12-24  
**Status:** Auto-setup in progress  
**Next:** Complete Python install → Run get-bridge-password.sh
