# Deployment

Three production paths, ordered by robustness:

1. **Docker Compose + runtime provider mesh** (recommended) — fallback across providers, **no proxy process needed**
2. **Docker Compose standalone** — Phus alone, multi-provider via profiles (no cross-provider fallback)
3. **systemd** — bare-metal / VPS, single process

Phus now ships its own runtime **provider mesh** (Phase C). You define multiple endpoints per profile in `phus.config.yaml`, and Phus picks the best one at runtime with failover, circuit breaker, and cost/latency awareness. No LiteLLM, no separate process — same resilience, zero ops.

---

## Docker Compose standalone (recommended — runtime mesh handles resilience)

Single container, runtime provider mesh handles cross-provider failover.

### What the runtime mesh gives you

| Concern | Handled by |
|---|---|
| Provider outage | Auto-failover to next endpoint in profile.mesh |
| Rate limiting (429) | Per-endpoint retry, then failover |
| Cost tracking | `phus mesh` shows per-endpoint success/cost |
| Latency tracking | `phus mesh` shows p95 latency per endpoint |
| Circuit breaker | Endpoint with N consecutive failures gets isolated for cooldown |
| Adding new provider | Add endpoint to profile.mesh in phus.config.yaml, no code |

### 1. Configure

```bash
cp .env.example .env
# Fill in provider keys:
#   OPENAI_API_KEY=sk-...
#   ANTHROPIC_API_KEY=sk-ant-...
#   DEEPSEEK_API_KEY=ark-...   # for Volcano Ark
```

### 2. Define a mesh profile in `phus.config.yaml`

```yaml
providers:
  profiles:
    smart-mesh:
      meshStrategy: failover
      description: "Sonnet → GPT-4o → Volcano Ark"
      mesh:
        - name: claude-sonnet
          provider: anthropic
          modelId: claude-sonnet-4-20250514
          priority: 0
        - name: gpt-4o
          provider: openai
          modelId: gpt-4o
          priority: 1
        - name: deepseek-v4-pro
          provider: openai
          modelId: deepseek-v4-pro-260425
          baseUrl: https://ark.cn-beijing.volces.com/api/v3
          apiKeyEnv: DEEPSEEK_API_KEY
          priority: 2
```

### 3. Run

```bash
docker compose up -d
docker compose logs -f phus
```

### 4. Use

```bash
# Phus handles provider resilience transparently
phus run "summarize this repo"
phus tasks

# See live mesh status
phus
> ,mesh

# Check from outside
phus mesh   # (TODO: add CLI command — currently via TUI only)
```

---

## Docker Compose + LiteLLM proxy (alternative)

For organizations that already run LiteLLM, or need its dashboard (cost / user management / rate limiting per key).

### What LiteLLM adds on top of Phus mesh

| Feature | Phus mesh | LiteLLM |
|---|---|---|
| Cross-provider failover | ✅ | ✅ |
| Circuit breaker | ✅ | ✅ |
| Per-user API keys | ❌ | ✅ |
| Cost dashboard | ❌ | ✅ (`http://localhost:4000`) |
| Caching | ❌ | ✅ |
| Multiple Phus instances sharing auth | ❌ | ✅ |

If you only need resilience, use Phus mesh alone. If you need user/key management + cost dashboard, run LiteLLM too.

The repo ships `deploy/litellm-config.yaml` and `deploy/litellm.Dockerfile` for this case. The `docker-compose.yml` runs both services.

### When to use LiteLLM

- Multiple users / API keys (LiteLLM mints sub-keys)
- Need cost dashboard without building one
- Caching responses across users
- Shared proxy across multiple Phus instances

### When NOT to use LiteLLM

- Single user, single Phus → runtime mesh is enough
- Self-hosted air-gapped → adds ops surface for no gain
- Want Phus to own the resilience logic → mesh does this in-process

---

## systemd (bare-metal)

For deploying Phus on a VPS without Docker. Single-process, runtime mesh still applies.

### 1. Install Phus to `/opt/phus`


The repo ships a `docker-compose.yml` that runs Phus as a long-lived gateway.

### 1. Set environment

Create `.env` at the repo root (next to `docker-compose.yml`):

```bash
PHUS_MODEL=openrouter/deepseek/deepseek-chat-v3
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_TOKEN=                    # leave empty to skip telegram
```

### 2. Build and run

```bash
docker compose up -d
docker compose logs -f phus
```

### 3. Health check

```bash
docker compose ps                  # STATUS column shows healthy/unhealthy
docker compose exec phus phus health
```

The container's `HEALTHCHECK` runs `node dist/phus.js health` every 30s.

### 4. Persisted state

Two named volumes keep state across container recreations:

| Volume | Mounted at | Holds |
|---|---|---|
| `phus-home` | `/app/.phus` | Tape (`tape.sqlite`), skills, startup.sh, plugins |
| `phus-logs` | `/app/logs` | `phus.jsonl` structured logs |

To inspect:

```bash
docker compose exec phus ls -la /app/.phus
docker compose exec phus sqlite3 /app/.phus/tape.sqlite 'SELECT COUNT(*) FROM tape;'
docker compose exec phus phus trace tui:user --limit 10
```

### 5. Customizing the run

Override the command in `docker-compose.yml` if you want Telegram alongside WebSocket:

```yaml
services:
  phus:
    command: ["gateway", "--websocket", "8080", "--telegram"]
```

Or override per-run:

```bash
docker compose run --rm phus run "summarize this container"
docker compose run --rm phus compact cli:user --keep-recent 20
```

---

## systemd (bare-metal / VPS)

### 1. Install Phus to `/opt/phus`

```bash
git clone <repo-url> /opt/phus
cd /opt/phus
npm ci --omit=dev
npm run build
sudo useradd --system --shell /usr/sbin/nologin --home /var/lib/phus phus
sudo mkdir -p /var/lib/phus /var/log/phus
sudo chown -R phus:phus /var/lib/phus /var/log/phus /opt/phus
```

### 2. Configure secrets

```bash
sudo mkdir -p /etc/phus
sudo tee /etc/phus/phus.env > /dev/null <<'EOF'
PHUS_MODEL=openrouter/deepseek/deepseek-chat-v3
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_TOKEN=
EOF
sudo chmod 600 /etc/phus/phus.env
```

### 3. Install the unit file

The repo ships `deploy/phus.service`. Copy and enable:

```bash
sudo cp deploy/phus.service /etc/systemd/system/phus.service
sudo systemctl daemon-reload
sudo systemctl enable --now phus
sudo systemctl status phus
```

### 4. Watch the logs

```bash
sudo journalctl -u phus -f                # stderr → journald
sudo tail -f /var/log/phus/phus.jsonl     # structured → file
```

### 5. Operate

```bash
sudo systemctl restart phus               # restart
sudo systemctl stop phus                  # stop
phus health                               # health probe (as phus user)
phus trace tui:user                       # inspect a session
phus logs --follow                        # tail structured log
phus compact tui:user                     # manually compact a session
```

The unit includes `WatchdogSec` (via `Restart=on-failure`) so systemd will surface crashes in `journalctl`.

---

## Health probe

`phus health` returns exit 0 if all checks pass:

```bash
$ phus health
✅ tape_db: /var/lib/phus/tape.sqlite
✅ skills_dir: /var/lib/phus/skills
✅ provider_key: OPENAI_API_KEY
✅ log_file: /var/log/phus/phus.jsonl
$ echo $?
0
```

What it checks:

| Check | Pass condition |
|---|---|
| `tape_db` | File exists at `$PHUS_TAPE_DB` (created on first turn) |
| `skills_dir` | Directory exists at `$PHUS_SKILLS_DIR` |
| `provider_key` | At least one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `GROQ_API_KEY` is set |
| `log_file` | `$PHUS_LOG_FILE` is writable (or its parent dir is) |

Use `phus health --json` to pipe into a monitoring system.

---

## Graceful shutdown

Both Docker (`docker stop`) and systemd (`systemctl stop`) send SIGTERM. Phus catches it and runs `ch.close()` for every active channel before exiting 0. The gateway logs `gateway.shutdown` with the signal name.

If the process doesn't exit within 10s, the supervisor sends SIGKILL.

---

## Configuration

Phus's non-secret configuration lives in **one place**: `$PHUS_HOME/phus.config.yaml`. Secrets (API keys, the Telegram token) stay in the environment and are referenced from YAML via `${VAR}` interpolation. The full precedence table:

| Setting | Source precedence |
|---|---|
| `paths.home` | `PHUS_HOME` env > YAML `paths.home` > `./.phus` |
| `paths.tapeDb` | YAML `paths.tapeDb` > `./tape.sqlite` |
| `paths.skillsDir` | YAML `paths.skillsDir` > `./skills` |
| `log.file` | `PHUS_LOG_FILE` env > YAML `log.file` > `./logs/phus.jsonl` |
| `log.level` | `PHUS_LOG_LEVEL` env > YAML `log.level` > `info` |
| `profileName` | `PHUS_PROFILE` env > YAML `providers.defaultProfile` > `default` |
| Provider profiles, mesh, plugins, schedules | YAML only |

Every section under `paths`, `log`, `providers`, `plugins`, `schedules` is optional; missing keys fall back to the defaults in the table. Example:

```yaml
paths:
  tapeDb: /var/lib/phus/tape.sqlite
  skillsDir: /var/lib/phus/skills
log:
  file: /var/log/phus/phus.jsonl
  level: info
providers:
  defaultProfile: smart
  profiles:
    smart:
      model: anthropic/claude-sonnet-4-20250514
      thinkingLevel: medium
plugins:
  - path: ./plugins/greet-everyone.ts
schedules:
  - name: heartbeat
    cron: "*/15 * * * *"
    hookName: system_prompt
```

### Interpolating secrets

Anywhere in YAML you can write `${VAR}` and Phus will substitute the value of `process.env.VAR` at load time. Defaults via `${VAR:-fallback}` are supported. Unset, non-defaulted references are left literal and a `config.interpolate_unset` event is logged once per name.

```yaml
providers:
  profiles:
    volcano:
      model: deepseek/deepseek-v3-250324
      baseUrl: https://ark.cn-beijing.volces.com/api/v3
      apiKeyEnv: VOLCANO_API_KEY   # env-only, never the literal key
```

### Env vars that still win

For one release, the four env vars below override their YAML counterparts. Setting any of them emits a `config.env_override_used` warn event so you notice:

| Env | Replaces |
|---|---|
| `PHUS_HOME` | `paths.home` |
| `PHUS_LOG_FILE` | `log.file` |
| `PHUS_LOG_LEVEL` | `log.level` |
| `PHUS_PROFILE` | `providers.defaultProfile` |

These are deployment overrides (set them in your systemd unit, Docker compose, or k8s manifest). They will become no-ops in a future release — move them into YAML.

### What stays env-only

- Provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `HF_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`)
- `TELEGRAM_TOKEN`
- `PHUS_DEBUG_WIRE` — Pi wire-payload debug toggle (off by default)

These never become part of the YAML file — secrets stay out of version control.

---

## Resource sizing

Phus itself is tiny (~50 MB RSS at idle). The memory ceiling is dominated by:

- **Pi Agent's message buffer** — grows with conversation length
- **Tape SQLite WAL** — bounded by `journal_mode = WAL`; checkpoints automatically
- **LLM API context windows** — token usage is bounded by the model you pick

For a gateway serving 1 channel with occasional use, 256 MB is plenty. For high-throughput multi-channel usage, 1 GB + `PHUS_MAX_STEPS=50` (default) is fine.

---

## Updating

```bash
cd /opt/phus
git pull
npm ci --omit=dev
npm run build
sudo systemctl restart phus

# or with docker:
git pull
docker compose build
docker compose up -d
```

After updating, the Tape and skills survive (they live in `/var/lib/phus` / `phus-home` volume). Plugin code is loaded from `$PHUS_HOME/plugins/` — re-edit and restart to pick up changes.

---

## What's not in this doc

- **TLS / reverse proxy** — front Phus with Caddy / nginx if you expose it to the internet. WebSocket on `:8080` is plain.
- **Backups** — `tar czf phus-backup.tgz /var/lib/phus` is sufficient; the tape is a single SQLite file.
- **Multi-host** — currently no clustering. Each Phus instance has its own tape; for shared sessions you'd point all instances at the same NFS-mounted `$PHUS_HOME` (SQLite over NFS works for low write rates but isn't recommended for high throughput).
