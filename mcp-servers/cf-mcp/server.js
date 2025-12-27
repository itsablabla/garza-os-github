import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import Imap from "imap";
import nodemailer from "nodemailer";
import { z } from "zod";

const API_KEY = "garza-secure-key-2024";
const PORT = 3333;

// ProtonMail Bridge configuration
const BRIDGE_CONFIG = {
  imap: {
    user: "jadengarza@pm.me",
    password: "n1skcXYq4jyYKY4QYGWksQ",
    host: "127.0.0.1",
    port: 1143,
    tls: false,
    autotls: "required",
    tlsOptions: { rejectUnauthorized: false }
  },
  smtp: {
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    auth: {
      user: "jadengarza@pm.me",
      password: "n1skcXYq4jyYKY4QYGWksQ"
    },
    tls: { rejectUnauthorized: false }
  }
};

// ============================================
// IMAP HELPER FUNCTIONS
// ============================================

function createImapConnection() {
  return new Imap(BRIDGE_CONFIG.imap);
}

async function searchProtonMail(criteria, limit, folder = "INBOX") {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection();
    const results = [];

    imap.once("ready", () => {
      imap.openBox(folder, true, (err) => {
        if (err) return reject(err);

        imap.search([criteria], (err, uids) => {
          if (err) return reject(err);
          if (!uids || uids.length === 0) {
            imap.end();
            return resolve([]);
          }

          const limitedUids = uids.slice(-limit);
          const fetch = imap.fetch(limitedUids, { bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)"], struct: true });

          fetch.on("message", (msg) => {
            const result = {};
            msg.on("body", (stream, info) => {
              let buffer = "";
              stream.on("data", (chunk) => buffer += chunk.toString("utf8"));
              stream.once("end", () => {
                if (info.which.includes("HEADER")) {
                  const lines = buffer.split("\r\n");
                  lines.forEach(line => {
                    if (line.startsWith("From:")) result.from = line.substring(5).trim();
                    if (line.startsWith("Subject:")) result.subject = line.substring(8).trim();
                    if (line.startsWith("Date:")) result.date = line.substring(5).trim();
                  });
                }
              });
            });
            msg.once("attributes", (attrs) => {
              result.uid = attrs.uid;
              result.flags = attrs.flags;
            });
            msg.once("end", () => results.push(result));
          });

          fetch.once("end", () => imap.end());
        });
      });
    });

    imap.once("error", reject);
    imap.once("end", () => resolve(results));
    imap.connect();
  });
}

async function readProtonMail(uid, folder = "INBOX") {
  console.log(`[readProtonMail] Starting for UID ${uid} in ${folder}`);
  return new Promise((resolve, reject) => {
    const imap = createImapConnection();
    let emailBody = "";
    let timeout = setTimeout(() => {
      console.log('[readProtonMail] Timeout reached');
      try { imap.end(); } catch(e) {}
      resolve({ uid, body: emailBody || "TIMEOUT" });
    }, 20000);

    imap.once("ready", () => {
      console.log('[readProtonMail] IMAP ready');
      imap.openBox(folder, true, (err) => {
        if (err) {
          console.log('[readProtonMail] openBox error:', err.message);
          clearTimeout(timeout);
          return reject(err);
        }
        console.log('[readProtonMail] Box opened, fetching...');

        const fetch = imap.fetch([uid], { bodies: "" });

        fetch.on("message", (msg, seqno) => {
          console.log(`[readProtonMail] Got message ${seqno}`);
          msg.on("body", (stream) => {
            stream.on("data", (chunk) => {
              emailBody += chunk.toString("utf8");
            });
            stream.once("end", () => {
              console.log(`[readProtonMail] Body stream ended, length: ${emailBody.length}`);
            });
          });
        });

        fetch.once("error", (err) => {
          console.log('[readProtonMail] Fetch error:', err.message);
          clearTimeout(timeout);
          imap.end();
        });

        fetch.once("end", () => {
          console.log('[readProtonMail] Fetch ended');
          clearTimeout(timeout);
          imap.end();
        });
      });
    });

    imap.once("error", (err) => {
      console.log('[readProtonMail] IMAP error:', err.message);
      clearTimeout(timeout);
      reject(err);
    });
    
    imap.once("end", () => {
      console.log('[readProtonMail] IMAP connection ended');
      clearTimeout(timeout);
      resolve({ uid, body: emailBody });
    });

    console.log('[readProtonMail] Connecting...');
    imap.connect();
  });
}

async function sendProtonMail(to, subject, body, cc, bcc) {
  const transporter = nodemailer.createTransport(BRIDGE_CONFIG.smtp);
  const mailOptions = {
    from: "jadengarza@pm.me",
    to,
    subject,
    text: body,
    cc: cc || undefined,
    bcc: bcc || undefined
  };

  const info = await transporter.sendMail(mailOptions);
  return { messageId: info.messageId, accepted: info.accepted };
}

async function listFolders() {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection();

    imap.once("ready", () => {
      imap.getBoxes((err, boxes) => {
        if (err) return reject(err);
        
        const folders = [];
        function extractFolders(boxObj, prefix = "") {
          for (const [name, box] of Object.entries(boxObj)) {
            const fullPath = prefix ? `${prefix}/${name}` : name;
            folders.push({
              name: fullPath,
              delimiter: box.delimiter,
              flags: box.attribs
            });
            if (box.children) {
              extractFolders(box.children, fullPath);
            }
          }
        }
        extractFolders(boxes);
        imap.end();
        resolve(folders);
      });
    });

    imap.once("error", reject);
    imap.connect();
  });
}

async function moveEmail(uid, sourceFolder, destFolder) {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection();

    imap.once("ready", () => {
      imap.openBox(sourceFolder, false, (err) => {
        if (err) return reject(err);

        imap.move(uid, destFolder, (err) => {
          if (err) return reject(err);
          imap.end();
          resolve({ success: true, uid, movedTo: destFolder });
        });
      });
    });

    imap.once("error", reject);
    imap.connect();
  });
}

async function setFlags(uid, flags, add = true, folder = "INBOX") {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection();

    imap.once("ready", () => {
      imap.openBox(folder, false, (err) => {
        if (err) return reject(err);

        const method = add ? imap.addFlags.bind(imap) : imap.delFlags.bind(imap);
        method(uid, flags, (err) => {
          if (err) return reject(err);
          imap.end();
          resolve({ success: true, uid, flags, action: add ? "added" : "removed" });
        });
      });
    });

    imap.once("error", reject);
    imap.connect();
  });
}

async function deleteEmail(uid, folder = "INBOX") {
  return moveEmail(uid, folder, "Trash");
}

async function archiveEmail(uid, folder = "INBOX") {
  return moveEmail(uid, folder, "Archive");
}

async function markRead(uid, read = true, folder = "INBOX") {
  return setFlags(uid, ["\\Seen"], read, folder);
}

async function starEmail(uid, starred = true, folder = "INBOX") {
  return setFlags(uid, ["\\Flagged"], starred, folder);
}

async function bulkAction(uids, action, folder = "INBOX", destFolder = null) {
  const results = [];
  for (const uid of uids) {
    try {
      let result;
      switch (action) {
        case "archive": result = await archiveEmail(uid, folder); break;
        case "delete": result = await deleteEmail(uid, folder); break;
        case "mark_read": result = await markRead(uid, true, folder); break;
        case "mark_unread": result = await markRead(uid, false, folder); break;
        case "star": result = await starEmail(uid, true, folder); break;
        case "unstar": result = await starEmail(uid, false, folder); break;
        case "move":
          if (!destFolder) throw new Error("destFolder required for move action");
          result = await moveEmail(uid, folder, destFolder);
          break;
        default: throw new Error(`Unknown action: ${action}`);
      }
      results.push({ uid, success: true, ...result });
    } catch (err) {
      results.push({ uid, success: false, error: err.message });
    }
  }
  return results;
}

// ============================================
// MCP SERVER SETUP (New SDK API)
// ============================================

const server = new McpServer({ name: "cf-mcp-secure", version: "3.2.0" });

// TOOL: Search ProtonMail
server.registerTool(
  "search_protonmail",
  {
    description: "Search ProtonMail using IMAP criteria. Returns emails with flags (read/starred status).",
    inputSchema: {
      criteria: z.string().default("ALL").describe("IMAP search criteria (ALL, UNSEEN, FLAGGED, FROM x, SUBJECT x, etc)"),
      limit: z.number().default(10).describe("Maximum results"),
      folder: z.string().default("INBOX").describe("Folder to search")
    }
  },
  async ({ criteria = "ALL", limit = 10, folder = "INBOX" }) => {
    const results = await searchProtonMail(criteria, limit, folder);
    return {
      content: [{ type: "text", text: JSON.stringify(results.map(r => ({
        uid: r.uid,
        from: r.from,
        subject: r.subject,
        date: r.date,
        flags: r.flags,
        isRead: r.flags?.includes("\\Seen") || false,
        isStarred: r.flags?.includes("\\Flagged") || false
      })), null, 2) }]
    };
  }
);

// TOOL: Read ProtonMail
server.registerTool(
  "read_protonmail",
  {
    description: "Read full ProtonMail message by UID",
    inputSchema: {
      uid: z.number().describe("Message UID"),
      folder: z.string().default("INBOX").describe("Folder containing message")
    }
  },
  async ({ uid, folder = "INBOX" }) => {
    const result = await readProtonMail(uid, folder);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Send ProtonMail
server.registerTool(
  "send_protonmail",
  {
    description: "Send encrypted email via ProtonMail",
    inputSchema: {
      to: z.string().describe("Recipient email"),
      subject: z.string().describe("Subject"),
      body: z.string().describe("Body text"),
      cc: z.string().optional().describe("CC recipients"),
      bcc: z.string().optional().describe("BCC recipients")
    }
  },
  async ({ to, subject, body, cc, bcc }) => {
    const result = await sendProtonMail(to, subject, body, cc, bcc);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: List Folders
server.registerTool(
  "list_protonmail_folders",
  {
    description: "List all ProtonMail folders/labels",
    inputSchema: {}
  },
  async () => {
    const folders = await listFolders();
    return { content: [{ type: "text", text: JSON.stringify(folders, null, 2) }] };
  }
);

// TOOL: Archive
server.registerTool(
  "archive_protonmail",
  {
    description: "Archive an email (move to Archive folder)",
    inputSchema: {
      uid: z.number().describe("Message UID"),
      folder: z.string().default("INBOX").describe("Source folder")
    }
  },
  async ({ uid, folder = "INBOX" }) => {
    const result = await archiveEmail(uid, folder);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Delete
server.registerTool(
  "delete_protonmail",
  {
    description: "Delete an email (move to Trash)",
    inputSchema: {
      uid: z.number().describe("Message UID"),
      folder: z.string().default("INBOX").describe("Source folder")
    }
  },
  async ({ uid, folder = "INBOX" }) => {
    const result = await deleteEmail(uid, folder);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Mark Read/Unread
server.registerTool(
  "mark_protonmail",
  {
    description: "Mark email as read or unread",
    inputSchema: {
      uid: z.number().describe("Message UID"),
      read: z.boolean().default(true).describe("true=mark read, false=mark unread"),
      folder: z.string().default("INBOX").describe("Folder")
    }
  },
  async ({ uid, read = true, folder = "INBOX" }) => {
    const result = await markRead(uid, read, folder);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Star/Unstar
server.registerTool(
  "star_protonmail",
  {
    description: "Star or unstar an email",
    inputSchema: {
      uid: z.number().describe("Message UID"),
      starred: z.boolean().default(true).describe("true=star, false=unstar"),
      folder: z.string().default("INBOX").describe("Folder")
    }
  },
  async ({ uid, starred = true, folder = "INBOX" }) => {
    const result = await starEmail(uid, starred, folder);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Move
server.registerTool(
  "move_protonmail",
  {
    description: "Move email to a different folder",
    inputSchema: {
      uid: z.number().describe("Message UID"),
      destFolder: z.string().describe("Destination folder"),
      sourceFolder: z.string().default("INBOX").describe("Source folder")
    }
  },
  async ({ uid, destFolder, sourceFolder = "INBOX" }) => {
    const result = await moveEmail(uid, sourceFolder, destFolder);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Bulk Actions
server.registerTool(
  "bulk_protonmail",
  {
    description: "Perform bulk actions on multiple emails",
    inputSchema: {
      uids: z.array(z.number()).describe("Array of message UIDs"),
      action: z.string().describe("Action: archive, delete, mark_read, mark_unread, star, unstar, move"),
      folder: z.string().default("INBOX").describe("Source folder"),
      destFolder: z.string().optional().describe("Destination folder (required for move action)")
    }
  },
  async ({ uids, action, folder = "INBOX", destFolder }) => {
    const results = await bulkAction(uids, action, folder, destFolder);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ============================================
// UNIFI PROTECT SERVER MANAGEMENT
// ============================================

const PROTECT_SERVER = {
  path: "/Users/customer/Projects/protect-vision-server",
  port: 3847,
  logFile: "/Users/customer/Projects/protect-vision-server/logs/server.log"
};

async function execCommand(cmd) {
  return new Promise((resolve) => {
    import("child_process").then(({ exec }) => {
      exec(cmd, (error, stdout, stderr) => {
        resolve({ stdout: stdout || "", stderr: stderr || "", error: error?.message });
      });
    });
  });
}

server.registerTool(
  "protect_server_status",
  {
    description: "Check if UniFi Protect Vision server is running",
    inputSchema: {}
  },
  async () => {
    const ps = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
    const health = await fetch(`http://localhost:${PROTECT_SERVER.port}/health`).then(r => r.json()).catch(e => ({ error: e.message }));
    const isRunning = ps.stdout.includes("protect-vision-server");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          running: isRunning,
          pid: isRunning ? ps.stdout.match(/\s+(\d+)\s+/)?.[1] : null,
          health,
          port: PROTECT_SERVER.port
        }, null, 2)
      }]
    };
  }
);

server.registerTool(
  "protect_server_logs",
  {
    description: "Get UniFi Protect Vision server logs",
    inputSchema: {
      lines: z.number().default(50).describe("Number of log lines to return")
    }
  },
  async ({ lines = 50 }) => {
    const logs = await execCommand(`tail -${lines} ${PROTECT_SERVER.logFile} 2>/dev/null || cat ${PROTECT_SERVER.path}/logs/*.log 2>/dev/null | tail -${lines}`);
    return { content: [{ type: "text", text: logs.stdout || logs.stderr || "No logs found" }] };
  }
);

server.registerTool(
  "protect_server_restart",
  {
    description: "Restart the UniFi Protect Vision server",
    inputSchema: {}
  },
  async () => {
    // Kill existing
    await execCommand("pkill -f protect-vision-server || true");
    await new Promise(r => setTimeout(r, 1000));
    // Start new
    const start = await execCommand(`cd ${PROTECT_SERVER.path} && nohup node server.js >> logs/server.log 2>&1 &`);
    await new Promise(r => setTimeout(r, 2000));
    // Verify
    const ps = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: ps.stdout.includes("protect-vision-server"),
          message: ps.stdout.includes("protect-vision-server") ? "Server restarted successfully" : "Failed to restart",
          pid: ps.stdout.match(/\s+(\d+)\s+/)?.[1]
        }, null, 2)
      }]
    };
  }
);

server.registerTool(
  "protect_server_stop",
  {
    description: "Stop the UniFi Protect Vision server",
    inputSchema: {}
  },
  async () => {
    const result = await execCommand("pkill -f protect-vision-server");
    await new Promise(r => setTimeout(r, 500));
    const verify = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: !verify.stdout.includes("protect-vision-server"),
          message: !verify.stdout.includes("protect-vision-server") ? "Server stopped" : "Failed to stop"
        }, null, 2)
      }]
    };
  }
);

server.registerTool(
  "protect_server_start",
  {
    description: "Start the UniFi Protect Vision server",
    inputSchema: {}
  },
  async () => {
    // Check if already running
    const existing = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
    if (existing.stdout.includes("protect-vision-server")) {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Already running", pid: existing.stdout.match(/\s+(\d+)\s+/)?.[1] }, null, 2) }] };
    }
    // Start
    await execCommand(`cd ${PROTECT_SERVER.path} && nohup node server.js >> logs/server.log 2>&1 &`);
    await new Promise(r => setTimeout(r, 2000));
    const verify = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: verify.stdout.includes("protect-vision-server"),
          message: verify.stdout.includes("protect-vision-server") ? "Server started" : "Failed to start",
          pid: verify.stdout.match(/\s+(\d+)\s+/)?.[1]
        }, null, 2)
      }]
    };
  }
);

// ============================================
// EXPRESS SERVER

// ============================================
// YOUVERSION BIBLE API
// ============================================

const YVP_API_KEY = "YBlQWiiIZ80shMLwVF6vR9P5klEP25p8CPXSf3N1f5AlNXfL";
const YVP_BASE_URL = "https://api.youversion.com/v1";

async function biblePassage(reference, bibleId = "111") {
  const r = await fetch(`${YVP_BASE_URL}/bibles/${bibleId}/passages/${reference}`, { 
    headers: { "X-YVP-App-Key": YVP_API_KEY } 
  });
  return r.json();
}

async function bibleVotd() {
  const verses = ["JHN.3.16", "PHP.4.13", "ROM.8.28", "JER.29.11", "PRO.3.5-6", "ISA.41.10", "MAT.11.28", "PSA.23.1-6", "PSA.46.1", "2TI.1.7"];
  const ref = verses[Math.floor(Date.now() / 86400000) % verses.length];
  return biblePassage(ref);
}

async function bibleSearch(query, bibleId = "111") {
  const r = await fetch(`${YVP_BASE_URL}/bibles/${bibleId}/search?query=${encodeURIComponent(query)}`, { 
    headers: { "X-YVP-App-Key": YVP_API_KEY } 
  });
  return r.json();
}

async function bibleVersions() {
  const r = await fetch(`${YVP_BASE_URL}/bibles`, { 
    headers: { "X-YVP-App-Key": YVP_API_KEY } 
  });
  return r.json();
}

// TOOL: Bible Verse of the Day
server.registerTool(
  "bible_votd",
  {
    description: "Get Bible verse of the day",
    inputSchema: {}
  },
  async () => {
    const result = await bibleVotd();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Bible Passage
server.registerTool(
  "bible_passage",
  {
    description: "Get Bible passage by reference (e.g. JHN.3.16, PSA.23, ROM.8.28-39)",
    inputSchema: {
      reference: z.string().describe("Bible reference like JHN.3.16 or PSA.23"),
      bible_id: z.string().default("111").describe("Bible version ID (111=NIV)")
    }
  },
  async ({ reference, bible_id = "111" }) => {
    const result = await biblePassage(reference, bible_id);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Bible Search
server.registerTool(
  "bible_search",
  {
    description: "Search Bible for text",
    inputSchema: {
      query: z.string().describe("Search query"),
      bible_id: z.string().default("111").describe("Bible version ID")
    }
  },
  async ({ query, bible_id = "111" }) => {
    const result = await bibleSearch(query, bible_id);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// TOOL: Bible Versions
server.registerTool(
  "bible_versions",
  {
    description: "List available Bible versions",
    inputSchema: {}
  },
  async () => {
    const result = await bibleVersions();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);
// ============================================

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const apiKey = req.headers["x-api-key"] || req.query.key;
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

const transports = new Map();

app.get("/sse", (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport, true);
  server.connect(transport);
  
  res.on("close", () => {
    transports.delete(transport);
  });
});

app.post("/messages", (req, res) => {
  const transport = Array.from(transports.keys())[0];
  if (transport) {
    transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No active SSE connection" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    name: "cf-mcp-secure",
    version: "3.2.0",
    features: [
      "search_protonmail", "read_protonmail", "send_protonmail",
      "list_protonmail_folders", "archive_protonmail", "delete_protonmail",
      "mark_protonmail", "star_protonmail", "move_protonmail", "bulk_protonmail",
      "protect_server_status", "protect_server_logs", "protect_server_restart",
      "protect_server_stop", "protect_server_start", "bible_votd", "bible_passage", "bible_search", "bible_versions"
    ],
    security: "API key authentication enabled"
  });
});

// Direct endpoint for CF Worker proxy
app.post("/direct", async (req, res) => {
  try {
    const { tool, arguments: args } = req.body;
    if (!tool) return res.status(400).json({ error: "Tool name required" });

    let result;
    switch(tool) {
      case "search_protonmail":
        const searchResults = await searchProtonMail(args.criteria || "ALL", args.limit || 10, args.folder || "INBOX");
        result = searchResults.map(r => ({
          uid: r.uid, from: r.from, subject: r.subject, date: r.date, flags: r.flags,
          isRead: r.flags?.includes("\\Seen") || false,
          isStarred: r.flags?.includes("\\Flagged") || false
        }));
        break;
      case "read_protonmail":
        result = await readProtonMail(args.uid, args.folder || "INBOX");
        break;
      case "send_protonmail":
        result = await sendProtonMail(args.to, args.subject, args.body, args.cc, args.bcc);
        break;
      case "list_protonmail_folders":
        result = await listFolders();
        break;
      case "archive_protonmail":
        result = await archiveEmail(args.uid, args.folder || "INBOX");
        break;
      case "delete_protonmail":
        result = await deleteEmail(args.uid, args.folder || "INBOX");
        break;
      case "mark_protonmail":
        result = await markRead(args.uid, args.read !== false, args.folder || "INBOX");
        break;
      case "star_protonmail":
        result = await starEmail(args.uid, args.starred !== false, args.folder || "INBOX");
        break;
      case "move_protonmail":
        result = await moveEmail(args.uid, args.sourceFolder || "INBOX", args.destFolder);
        break;
      case "bulk_protonmail":
        result = await bulkAction(args.uids, args.action, args.folder || "INBOX", args.destFolder);
        break;
      case "protect_server_status": {
        const ps = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
        const health = await fetch(`http://localhost:${PROTECT_SERVER.port}/health`).then(r => r.json()).catch(e => ({ error: e.message }));
        result = { running: ps.stdout.includes("protect-vision-server"), health, port: PROTECT_SERVER.port };
        break;
      }
      case "protect_server_logs": {
        const logs = await execCommand(`tail -${args.lines || 50} ${PROTECT_SERVER.logFile} 2>/dev/null || cat ${PROTECT_SERVER.path}/logs/*.log 2>/dev/null | tail -${args.lines || 50}`);
        result = { logs: logs.stdout || logs.stderr || "No logs" };
        break;
      }
      case "protect_server_restart": {
        await execCommand("pkill -f protect-vision-server || true");
        await new Promise(r => setTimeout(r, 1000));
        await execCommand(`cd ${PROTECT_SERVER.path} && nohup node server.js >> logs/server.log 2>&1 &`);
        await new Promise(r => setTimeout(r, 2000));
        const ps = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
        result = { success: ps.stdout.includes("protect-vision-server"), message: "Server restarted" };
        break;
      }
      case "protect_server_stop": {
        await execCommand("pkill -f protect-vision-server");
        result = { success: true, message: "Server stopped" };
        break;
      }
      // Abode proxy forwarding
      case "abode_get_mode":
      case "abode_set_mode":
      case "abode_list_devices":
      case "abode_get_device":
      case "abode_switch_device":
      case "abode_lock_device":
      case "abode_list_automations":
      case "abode_trigger_automation":
      case "abode_get_settings": {
        const action = tool.replace("abode_", "");
        const abodeRes = await fetch(`http://localhost:3457/api/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": "abode-proxy-key-2024" },
          body: JSON.stringify(args || {})
        });
        result = await abodeRes.json();
        break;
      }
      case "bible_votd": { result = await bibleVotd(); break; }
      case "bible_passage": { result = await biblePassage(args.reference, args.bible_id || "111"); break; }
      case "bible_search": { result = await bibleSearch(args.query, args.bible_id || "111"); break; }
      case "bible_versions": { result = await bibleVersions(); break; }
      case "protect_server_start": {
        await execCommand(`cd ${PROTECT_SERVER.path} && nohup node server.js >> logs/server.log 2>&1 &`);
        await new Promise(r => setTimeout(r, 2000));
        const ps = await execCommand("ps aux | grep protect-vision-server | grep -v grep");
        result = { success: ps.stdout.includes("protect-vision-server"), message: "Server started" };
        break;
      }
      default:
        return res.status(404).json({ error: `Unknown tool: ${tool}` });
    }

    res.json(result);
  } catch (error) {
    console.error("Direct endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CF MCP Server v3.0 (Inbox Zero) running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`SSE: http://localhost:${PORT}/sse?key=${API_KEY}`);
  console.log(`Tools: search, read, send, folders, archive, delete, mark, star, move, bulk`);
});
