import { createServer } from "http";
import { spawn } from "child_process";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

const PORT = parseInt(process.env.PORT || "8080");
const API_KEY = process.env.DROID_API_KEY || "";
const FACTORY_API_KEY = process.env.FACTORY_API_KEY || "";

async function runDroid(prompt, sessionId) {
  const workDir = join("/tmp", "droid-" + randomBytes(8).toString("hex"));
  await mkdir(workDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HOME: "/root",
      FACTORY_API_KEY,
      PATH: "/usr/local/bin:/usr/bin:/bin",
    };

    const args = [
      "exec",
      "--output", "text",
      "--non-interactive",
      prompt,
    ];

    if (sessionId) {
      args.push("--session-id", sessionId);
    }

    const proc = spawn("/usr/local/bin/droid", args, {
      cwd: workDir,
      env,
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", async (code) => {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (code === 0 || stdout) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `droid exited with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Auth
  if (API_KEY) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${API_KEY}`) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end("Bad JSON");
    return;
  }

  const { prompt, sessionId } = payload;
  if (!prompt) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "prompt required" }));
    return;
  }

  try {
    const output = await runDroid(prompt, sessionId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, output }));
  } catch (err) {
    console.error("droid error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`droid-runner listening on :${PORT}`);
});
