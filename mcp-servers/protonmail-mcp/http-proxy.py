#!/usr/bin/env python3
"""HTTP proxy for ProtonMail Bridge v2 - Full IMAP operations"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import imaplib
import smtplib
import email
from email.mime.text import MIMEText
from email.header import decode_header
import json

IMAP_HOST = "127.0.0.1"
IMAP_PORT = 1143
SMTP_HOST = "127.0.0.1"
SMTP_PORT = 1025
EMAIL = "jadengarza@pm.me"
PASSWORD = "n1skcXYq4jyYKY4QYGWksQ"

class ProtonHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        data = json.loads(body) if body else {}
        
        try:
            if self.path == '/direct':
                tool = data.get('tool', '')
                args = data.get('arguments', {})
                result = self.handle_tool(tool, args)
            else:
                result = {"error": "Use /direct endpoint"}
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
    
    def handle_tool(self, tool, args):
        handlers = {
            'search_protonmail': lambda: self.search_emails(args.get('criteria', 'ALL'), args.get('limit', 10)),
            'read_protonmail': lambda: self.read_email(args.get('uid')),
            'send_protonmail': lambda: self.send_email(args),
            'list_protonmail_folders': lambda: self.list_folders(),
            'archive_protonmail': lambda: self.move_email(args.get('uid'), args.get('folder', 'INBOX'), 'Archive'),
            'delete_protonmail': lambda: self.move_email(args.get('uid'), args.get('folder', 'INBOX'), 'Trash'),
            'mark_protonmail': lambda: self.mark_email(args.get('uid'), args.get('read', True), args.get('folder', 'INBOX')),
            'star_protonmail': lambda: self.star_email(args.get('uid'), args.get('starred', True), args.get('folder', 'INBOX')),
            'move_protonmail': lambda: self.move_email(args.get('uid'), args.get('sourceFolder', 'INBOX'), args.get('destFolder')),
            'bulk_protonmail': lambda: self.bulk_operation(args),
        }
        handler = handlers.get(tool)
        return handler() if handler else {"error": f"Unknown tool: {tool}"}
    
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok","service":"protonmail-proxy","version":"2.0"}')
        else:
            self.send_response(404)
            self.end_headers()
    
    def get_mail(self, folder='INBOX'):
        mail = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
        mail.login(EMAIL, PASSWORD)
        mail.select(folder)
        return mail
    
    def list_folders(self):
        mail = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
        mail.login(EMAIL, PASSWORD)
        _, folders = mail.list()
        result = []
        for f in folders:
            decoded = f.decode() if isinstance(f, bytes) else str(f)
            parts = decoded.split(' "/" ')
            if len(parts) == 2:
                result.append(parts[1].strip('"'))
        mail.logout()
        return {"folders": result}
    
    def search_emails(self, criteria, limit):
        mail = self.get_mail()
        _, nums = mail.search(None, criteria)
        uids = nums[0].split()[-limit:] if nums[0] else []
        
        results = []
        for uid in reversed(uids):
            _, msg_data = mail.fetch(uid, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
            if msg_data[0]:
                header = email.message_from_bytes(msg_data[0][1])
                subj = header.get('Subject', '')
                if subj:
                    decoded = decode_header(subj)
                    subj = ''.join([t[0].decode(t[1] or 'utf-8') if isinstance(t[0], bytes) else t[0] for t in decoded])
                results.append({
                    "uid": int(uid.decode()),
                    "from": str(header.get('From', '')),
                    "subject": subj,
                    "date": str(header.get('Date', ''))
                })
        mail.logout()
        return {"emails": results, "count": len(results)}
    
    def read_email(self, uid):
        if not uid: return {"error": "UID required"}
        mail = self.get_mail()
        _, msg_data = mail.fetch(str(uid), '(RFC822)')
        if not msg_data[0]: return {"error": "Email not found"}
        
        msg = email.message_from_bytes(msg_data[0][1])
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                    break
        else:
            body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
        
        mail.logout()
        return {"uid": uid, "from": str(msg.get('From', '')), "to": str(msg.get('To', '')),
                "subject": str(msg.get('Subject', '')), "date": str(msg.get('Date', '')), "body": body[:5000]}
    
    def send_email(self, args):
        to, subject, body = args.get('to'), args.get('subject'), args.get('body')
        if not all([to, subject, body]): return {"error": "to, subject, body required"}
        
        msg = MIMEText(body)
        msg['From'] = EMAIL
        msg['To'] = to
        msg['Subject'] = subject
        if args.get('cc'): msg['Cc'] = args['cc']
        
        recipients = [to]
        if args.get('cc'): recipients.extend(args['cc'].split(','))
        if args.get('bcc'): recipients.extend(args['bcc'].split(','))
        
        smtp = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        smtp.login(EMAIL, PASSWORD)
        smtp.sendmail(EMAIL, recipients, msg.as_string())
        smtp.quit()
        return {"success": True, "message": f"Email sent to {to}"}
    
    def mark_email(self, uid, read, folder):
        if not uid: return {"error": "UID required"}
        mail = self.get_mail(folder)
        flag = '+FLAGS' if read else '-FLAGS'
        mail.store(str(uid), flag, '\\Seen')
        mail.logout()
        return {"success": True, "uid": uid, "read": read}
    
    def star_email(self, uid, starred, folder):
        if not uid: return {"error": "UID required"}
        mail = self.get_mail(folder)
        flag = '+FLAGS' if starred else '-FLAGS'
        mail.store(str(uid), flag, '\\Flagged')
        mail.logout()
        return {"success": True, "uid": uid, "starred": starred}
    
    def move_email(self, uid, source, dest):
        if not uid: return {"error": "UID required"}
        if not dest: return {"error": "Destination required"}
        mail = self.get_mail(source)
        mail.copy(str(uid), dest)
        mail.store(str(uid), '+FLAGS', '\\Deleted')
        mail.expunge()
        mail.logout()
        return {"success": True, "uid": uid, "from": source, "to": dest}
    
    def bulk_operation(self, args):
        uids = args.get('uids', [])
        action = args.get('action')
        folder = args.get('folder', 'INBOX')
        dest = args.get('destFolder')
        
        if not uids or not action: return {"error": "uids and action required"}
        
        results = []
        for uid in uids:
            if action == 'archive':
                results.append(self.move_email(uid, folder, 'Archive'))
            elif action == 'delete':
                results.append(self.move_email(uid, folder, 'Trash'))
            elif action == 'mark_read':
                results.append(self.mark_email(uid, True, folder))
            elif action == 'mark_unread':
                results.append(self.mark_email(uid, False, folder))
            elif action == 'star':
                results.append(self.star_email(uid, True, folder))
            elif action == 'unstar':
                results.append(self.star_email(uid, False, folder))
            elif action == 'move' and dest:
                results.append(self.move_email(uid, folder, dest))
        
        return {"processed": len(results), "results": results}
    
    def log_message(self, format, *args): pass

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 3456), ProtonHandler)
    print("ProtonMail proxy v2 running on http://127.0.0.1:3456")
    server.serve_forever()
