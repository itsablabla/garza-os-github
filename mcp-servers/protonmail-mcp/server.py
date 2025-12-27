import os
#!/usr/bin/env python3
"""
ProtonMail Bridge MCP Server
Provides search, read, and send capabilities for ProtonMail via Bridge
"""

import imaplib
import smtplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
import json
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Bridge connection details
IMAP_HOST = "127.0.0.1"
IMAP_PORT = 1143
SMTP_HOST = "127.0.0.1"
SMTP_PORT = 1025

# TODO: Get these from ProtonMail Bridge app
EMAIL = "jadengarza@pm.me"
BRIDGE_PASSWORD = os.getenv("PROTONMAIL_BRIDGE_PASSWORD", "")  # Read from environment


class ProtonMailClient:
    """Client for interacting with ProtonMail via Bridge"""
    
    def __init__(self):
        self.imap = None
    
    def connect_imap(self):
        """Connect to Bridge IMAP server"""
        if not self.imap:
            self.imap = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
            self.imap.login(EMAIL, BRIDGE_PASSWORD)
        return self.imap
    
    def search_emails(self, query="ALL", mailbox="INBOX", limit=10):
        """Search emails via IMAP"""
        try:
            mail = self.connect_imap()
            mail.select(mailbox)
            
            _, message_numbers = mail.search(None, query)
            
            if not message_numbers[0]:
                return []
            
            results = []
            msg_nums = message_numbers[0].split()[-limit:]
            
            for num in msg_nums:
                try:
                    _, msg_data = mail.fetch(num, "(RFC822)")
                    
                    if not msg_data or not msg_data[0]:
                        continue
                    
                    email_body = msg_data[0][1]
                    email_message = email.message_from_bytes(email_body)
                    
                    subject = email_message.get("Subject", "")
                    if subject:
                        decoded = decode_header(subject)[0]
                        if isinstance(decoded[0], bytes):
                            subject = decoded[0].decode(decoded[1] or 'utf-8')
                        else:
                            subject = decoded[0]
                    
                    body = ""
                    if email_message.is_multipart():
                        for part in email_message.walk():
                            if part.get_content_type() == "text/plain":
                                try:
                                    body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                                    break
                                except:
                                    pass
                    else:
                        try:
                            body = email_message.get_payload(decode=True).decode('utf-8', errors='ignore')
                        except:
                            body = ""
                    
                    results.append({
                        "id": num.decode(),
                        "from": email_message.get("From", ""),
                        "to": email_message.get("To", ""),
                        "subject": subject,
                        "date": email_message.get("Date", ""),
                        "body_preview": body[:300] if body else ""
                    })
                except Exception as e:
                    print(f"Error processing message {num}: {e}")
                    continue
            
            return results
            
        except Exception as e:
            raise Exception(f"Search failed: {str(e)}")
    
    def read_email(self, email_id, mailbox="INBOX"):
        """Read full email by ID"""
        try:
            mail = self.connect_imap()
            mail.select(mailbox)
            
            _, msg_data = mail.fetch(email_id.encode(), "(RFC822)")
            
            if not msg_data or not msg_data[0]:
                raise Exception(f"Email {email_id} not found")
            
            email_body = msg_data[0][1]
            email_message = email.message_from_bytes(email_body)
            
            subject = email_message.get("Subject", "")
            if subject:
                decoded = decode_header(subject)[0]
                if isinstance(decoded[0], bytes):
                    subject = decoded[0].decode(decoded[1] or 'utf-8')
                else:
                    subject = decoded[0]
            
            body = ""
            if email_message.is_multipart():
                for part in email_message.walk():
                    if part.get_content_type() == "text/plain":
                        try:
                            body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                            break
                        except:
                            pass
            else:
                try:
                    body = email_message.get_payload(decode=True).decode('utf-8', errors='ignore')
                except:
                    body = email_message.get_payload()
            
            return {
                "id": email_id,
                "from": email_message.get("From", ""),
                "to": email_message.get("To", ""),
                "subject": subject,
                "date": email_message.get("Date", ""),
                "cc": email_message.get("Cc", ""),
                "bcc": email_message.get("Bcc", ""),
                "body": body
            }
            
        except Exception as e:
            raise Exception(f"Read failed: {str(e)}")
    
    def send_email(self, to, subject, body, cc=None, bcc=None):
        """Send email via SMTP"""
        try:
            msg = MIMEMultipart()
            msg["From"] = EMAIL
            msg["To"] = to
            msg["Subject"] = subject
            
            if cc:
                msg["Cc"] = cc
            if bcc:
                msg["Bcc"] = bcc
            
            msg.attach(MIMEText(body, "plain"))
            
            smtp = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
            smtp.login(EMAIL, BRIDGE_PASSWORD)
            smtp.send_message(msg)
            smtp.quit()
            
            return {
                "status": "sent",
                "to": to,
                "subject": subject,
                "from": EMAIL
            }
            
        except Exception as e:
            raise Exception(f"Send failed: {str(e)}")


server = Server("protonmail-bridge")
pm_client = ProtonMailClient()


@server.list_tools()
async def list_tools():
    """List available ProtonMail tools"""
    return [
        Tool(
            name="search_protonmail",
            description="""Search ProtonMail emails using IMAP search queries.
            
Examples:
- "FROM sender@example.com" - Emails from specific sender
- "SUBJECT meeting" - Emails with "meeting" in subject
- "SINCE 01-Dec-2024" - Emails since a date
- "TEXT keyword" - Emails containing text
- "ALL" - All emails (respects limit)""",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "default": "ALL"},
                    "mailbox": {"type": "string", "default": "INBOX"},
                    "limit": {"type": "number", "default": 10}
                }
            }
        ),
        Tool(
            name="read_protonmail",
            description="Read full email content by ID",
            inputSchema={
                "type": "object",
                "properties": {
                    "email_id": {"type": "string"},
                    "mailbox": {"type": "string", "default": "INBOX"}
                },
                "required": ["email_id"]
            }
        ),
        Tool(
            name="send_protonmail",
            description="Send an email via ProtonMail",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                    "cc": {"type": "string"},
                    "bcc": {"type": "string"}
                },
                "required": ["to", "subject", "body"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Handle tool calls"""
    try:
        if name == "search_protonmail":
            results = pm_client.search_emails(
                query=arguments.get("query", "ALL"),
                mailbox=arguments.get("mailbox", "INBOX"),
                limit=arguments.get("limit", 10)
            )
            return [TextContent(type="text", text=json.dumps(results, indent=2))]
        
        elif name == "read_protonmail":
            result = pm_client.read_email(
                email_id=arguments["email_id"],
                mailbox=arguments.get("mailbox", "INBOX")
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        elif name == "send_protonmail":
            result = pm_client.send_email(
                to=arguments["to"],
                subject=arguments["subject"],
                body=arguments["body"],
                cc=arguments.get("cc"),
                bcc=arguments.get("bcc")
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        else:
            raise ValueError(f"Unknown tool: {name}")
    
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e)}, indent=2))]


async def main():
    """Run the MCP server"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
