# Deployment

Two production paths: **Docker Compose** (recommended for most) or **systemd** (for bare-metal / VPS).

Both run `phus gateway` in the foreground and rely on the host's process supervisor to restart on failure.

---

## Docker Compose

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
