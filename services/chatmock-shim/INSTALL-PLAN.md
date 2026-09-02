# Install plan — `openai-oauth` + `ChatMock` on `root@2.24.201.210` (Docker)

**Target host:** `srv1589219.hstgr.cloud` / `2.24.201.210`
**State today:** Ubuntu 24.04.4, Docker 29.4.0 + Compose v5.1.2, only `traefik:latest` running (host network, HTTP→HTTPS redirect, Let's Encrypt HTTP-01 resolver named `letsencrypt`, `--providers.docker.exposedbydefault=false`). Ports 22/80/443 in use, 7.8 GB RAM, 83 GB free.

---

## 0. Read-this-first — security & policy

Both projects expose an **unauthenticated OpenAI-compatible endpoint** backed by *your personal ChatGPT OAuth tokens* (the same `auth.json` Codex uses). Anyone who can reach the endpoint gets to spend your ChatGPT rate limits.

- `openai-oauth`'s own README: *"Use only for personal, local experimentation on trusted machines; **do not run as a hosted service**, do not share access, do not pool or redistribute tokens."* Running it on a public VPS behind a domain is exactly what that line warns against and risks OpenAI rate-limiting or suspending the account.
- `ChatMock` uses the same tokens; the README is silent but the risk is identical.

**Recommendation (baked into the plan below):** do not expose `/v1/*` to the public internet unauthenticated. Pick **one** of:
1. **Private-only** — bind to `127.0.0.1`, access via SSH tunnel / Tailscale / WireGuard. *(Safest, recommended.)*
2. **Public URL + Traefik basic-auth / IP allowlist middleware** — fine for solo use, still against `openai-oauth`'s stated policy.
3. **Public + no auth** — not recommended; flagged for explicit sign-off only.

Please tell me which tier you want before I execute.

---

## 1. Scope question for you

`openai-oauth` and `ChatMock` do **the same thing** (localhost proxy → `chatgpt.com/backend-api/codex/responses` using your Codex OAuth). Choose one of:

- **A. Both side-by-side** (different ports, share the same `~/.codex/auth.json` via bind-mount). Useful for A/B testing.
- **B. ChatMock only** — it already ships a working `Dockerfile` + `docker-compose.yml` + login flow. Least work.
- **C. openai-oauth only** — newer, Bun/TS, no upstream Docker support (we'd author it).

Default in this plan = **A (both)**, with a note on what to drop if you pick B or C.

---

## 2. Layout on the VPS

```
/opt/chatgpt-proxies/
├── auth/                       # shared ChatGPT OAuth credentials
│   └── auth.json               # created by the login step below
├── chatmock/
│   └── docker-compose.yml      # from upstream, lightly edited
│   └── .env                    # from .env.example
└── openai-oauth/
    ├── Dockerfile              # authored by us (see §4)
    ├── docker-compose.yml      # authored by us
    └── .dockerignore
```

One shared `auth.json` is mounted read-only into both containers at the path each expects (`/data/auth.json` for ChatMock via `CHATGPT_LOCAL_HOME=/data`; `/root/.codex/auth.json` for openai-oauth, overridable with `--oauth-file`).

---

## 3. ChatMock (upstream Docker assets exist)

Upstream ships `Dockerfile`, `docker-compose.yml`, `DOCKER.md`, `.env.example`. Plan:

1. `git clone https://github.com/RayBytes/ChatMock /opt/chatgpt-proxies/chatmock`
2. `cp .env.example .env`; set `VERBOSE=false`, keep `CHATMOCK_IMAGE=storagetime/chatmock:latest` (prebuilt) **or** switch to `build: .` to pin to the repo's own Dockerfile (safer than trusting the `storagetime/*` Docker Hub image — I recommend `build: .`).
3. **Login (one-time, interactive):**
   `docker compose run --rm --service-ports chatmock-login login`
   → prints an auth URL, you paste it into a browser, complete ChatGPT login, paste the redirect URL back. Tokens are written into the `chatmock_data` volume.
4. Optionally migrate the saved token to the shared bind-mount so `openai-oauth` can reuse it:
   `docker run --rm -v chatmock_data:/src -v /opt/chatgpt-proxies/auth:/dst alpine cp /src/auth.json /dst/`
5. Switch the main service to use the bind-mount instead of the named volume (edit compose):
   ```yaml
   volumes:
     - /opt/chatgpt-proxies/auth:/data
     - ./prompt.md:/app/prompt.md:ro
   ```
6. Don't publish `8000:8000` on `0.0.0.0`. Replace with `127.0.0.1:8000:8000` (private-only) **or** drop the `ports:` block and let Traefik route to it on the default bridge using labels (see §5).
7. `docker compose up -d chatmock` and verify `curl http://127.0.0.1:8000/v1/models`.

---

## 4. openai-oauth (no upstream Docker; we author it)

Repo is a Bun/TS monorepo (`bun@1.2.18`, `turbo`, `tsup`). CLI entry: `packages/openai-oauth/src/cli.ts`, built to `dist/cli.js`, defaults to binding `127.0.0.1:10531` and reading OAuth from `~/.codex/auth.json` (overridable via `--oauth-file`, `--host`, `--port`).

**Dockerfile (authored by us, sketch):**
```dockerfile
FROM oven/bun:1.2.18-alpine AS build
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.2.18-alpine
WORKDIR /app
COPY --from=build /src/packages/openai-oauth/dist ./dist
COPY --from=build /src/packages/openai-oauth/package.json ./package.json
COPY --from=build /src/node_modules ./node_modules
EXPOSE 10531
ENTRYPOINT ["bun", "dist/cli.js"]
CMD ["--host", "0.0.0.0", "--port", "10531", "--oauth-file", "/auth/auth.json"]
```

**docker-compose.yml:**
```yaml
services:
  openai-oauth:
    build: .
    container_name: openai-oauth
    restart: unless-stopped
    volumes:
      - /opt/chatgpt-proxies/auth:/auth:ro
    ports:
      - "127.0.0.1:10531:10531"   # private-only; see §5 for Traefik variant
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:10531/v1/models"]
      interval: 30s
      timeout: 5s
      retries: 3
```

**Login for openai-oauth:** the CLI intentionally does **not** ship a login flow. Options:
- (a) Reuse the `auth.json` created by the ChatMock login step (§3.4) — zero extra work.
- (b) On a machine with Node, run `npx @openai/codex login`, then `scp ~/.codex/auth.json root@2.24.201.210:/opt/chatgpt-proxies/auth/`.

---

## 5. Exposure (pick the tier from §0)

**Tier 1 — private only (recommended):**
- `ports:` are `127.0.0.1:8000:8000` and `127.0.0.1:10531:10531`.
- Access from your laptop via `ssh -L 8000:localhost:8000 -L 10531:localhost:10531 root@2.24.201.210`.
- No DNS / no Traefik route needed.

**Tier 2 — public hostname + basic-auth (solo use):**
- Decide subdomains (e.g. `chatmock.garzaos.cloud`, `openai-oauth.garzaos.cloud`) and point them at `2.24.201.210` (via Hostinger DNS / `$HOSTINGER_API_TOKEN`).
- Create a shared Docker network `web`, attach Traefik + both services to it, drop the host-network setup **or** keep Traefik on host-net and attach services to the default `bridge` (works because Traefik talks to container IPs via labels; confirmed by inspecting the existing `traefik-traefik-1` container).
- Add labels to each service:
  ```yaml
  labels:
    - traefik.enable=true
    - traefik.http.routers.chatmock.rule=Host(`chatmock.garzaos.cloud`)
    - traefik.http.routers.chatmock.entrypoints=websecure
    - traefik.http.routers.chatmock.tls.certresolver=letsencrypt
    - traefik.http.services.chatmock.loadbalancer.server.port=8000
    - traefik.http.routers.chatmock.middlewares=chatmock-auth
    - traefik.http.middlewares.chatmock-auth.basicauth.users=USER:$$2y$$...   # htpasswd bcrypt
  ```
- Same pattern for `openai-oauth` on `:10531`.
- Optional hardening middleware: `ipallowlist` for your home/office IP ranges.

**Tier 3 — public + no auth:** same as tier 2, minus the `basicauth` / `ipallowlist` middlewares. Not recommended; requires explicit sign-off.

---

## 6. Concrete execution steps (once you approve a tier + scope)

1. `ssh root@2.24.201.210`
2. `mkdir -p /opt/chatgpt-proxies/{auth,chatmock,openai-oauth}`
3. `git clone https://github.com/RayBytes/ChatMock /opt/chatgpt-proxies/chatmock`
4. `git clone https://github.com/EvanZhouDev/openai-oauth /opt/chatgpt-proxies/openai-oauth-src` → write our `Dockerfile` + `docker-compose.yml` into `/opt/chatgpt-proxies/openai-oauth/` that `build:` points at the cloned source.
5. In `chatmock/`: `cp .env.example .env`, edit compose to `build: .` + bind-mount `/opt/chatgpt-proxies/auth:/data`, remove `ports:` (tier 2) or set `127.0.0.1:8000:8000` (tier 1). Add Traefik labels if tier 2.
6. `docker compose run --rm --service-ports chatmock-login login` → complete OAuth in browser → verify `/opt/chatgpt-proxies/auth/auth.json` exists.
7. (tier 2 only) `curl -u user:pass https://chatmock.garzaos.cloud/v1/models` to confirm cert issued and auth works.
8. `docker compose up -d chatmock` (in chatmock dir) and `docker compose up -d openai-oauth` (in openai-oauth dir).
9. Smoke test both:
   - `curl http://127.0.0.1:8000/v1/models`
   - `curl http://127.0.0.1:10531/v1/models`
   - Chat completion: `curl http://127.0.0.1:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"gpt-5-codex","messages":[{"role":"user","content":"ping"}]}'`
10. Systemd isn't needed — `restart: unless-stopped` on both services is enough.

---

## 7. Day-2 ops

- **Updates:**
  - ChatMock: `cd /opt/chatgpt-proxies/chatmock && git pull && docker compose build --pull && docker compose up -d`
  - openai-oauth: same in its dir.
- **Token refresh:** both libraries auto-refresh using the refresh token in `auth.json`. If the ChatGPT session is forcibly signed out, re-run the ChatMock login (§3.3) — it'll rewrite `/opt/chatgpt-proxies/auth/auth.json` in place.
- **Backup:** `tar czf auth-backup.tgz /opt/chatgpt-proxies/auth` — `auth.json` is password-equivalent; store it like a secret.
- **Logs:** `docker compose logs -f chatmock` / `docker compose logs -f openai-oauth`. ChatMock has `VERBOSE=true` for deep request/stream logs.
- **Uninstall:** `docker compose down -v` in each dir and `rm -rf /opt/chatgpt-proxies`.

---

## 8. Things I need from you before executing

1. **Scope:** A (both), B (ChatMock only), or C (openai-oauth only)?
2. **Exposure tier:** 1 / 2 / 3 from §5?
3. **If tier 2:** which domain(s)? (I can auto-create the DNS records via `$HOSTINGER_API_TOKEN` once you name them, or you can point any subdomain you already own at `2.24.201.210`.)
4. **Confirm** you've read §0 and are okay with the "personal-use-only" policy trade-off of running these on a reachable server.

Once you answer those, I'll execute §6 end-to-end on the VPS and report back with working endpoints + smoke-test output.
