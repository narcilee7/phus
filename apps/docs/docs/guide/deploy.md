# 部署方式

Phus 支持多种部署方式，从简单到生产级排序：

| 方式 | 适用场景 | 复杂度 |
|---|---|---|
| [一键安装](#一键安装) | 快速试用 | ⭐ |
| [Docker Compose](#docker-compose) | 生产环境推荐 | ⭐⭐ |
| [systemd](#systemd) | VPS / 裸机 | ⭐⭐ |
| [Docker + LiteLLM](#docker--litellm) | 需要成本监控 | ⭐⭐⭐ |

---

## 一键安装

适用于 macOS、Linux、WSL。

```bash
curl -fsSL https://phus.dev/install.sh | bash
```

PowerShell (Windows):

```powershell
Invoke-WebRequest -Uri https://phus.dev/install.ps1 | Invoke-Expression
```

安装后运行配置向导：

```bash
phus setup
```

---

## Docker Compose

### 快速启动

```bash
# 克隆项目
git clone https://github.com/phus-lang/phus.git
cd phus

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API Key

# 启动
docker compose up -d

# 查看日志
docker compose logs -f phus
```

### .env 示例

```bash
# 至少配置一个 API Key
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# 可选：Telegram Bot Token
TELEGRAM_TOKEN=
```

### 持久化存储

| Volume | 挂载路径 | 内容 |
|---|---|---|
| `phus-home` | `/app/.phus` | Tape 数据库、Skills、Plugins |
| `phus-logs` | `/app/logs` | 结构化日志 |

### 自定义运行命令

```yaml
# docker-compose.yml
services:
  phus:
    command: ["gateway", "--websocket", "8080", "--telegram"]
```

### 自定义 Provider Mesh

在 `phus.config.yaml` 中配置多 Provider failover：

```yaml
providers:
  profiles:
    smart-mesh:
      meshStrategy: failover
      mesh:
        - name: claude
          provider: anthropic
          modelId: claude-sonnet-4-20250514
          priority: 0
        - name: gpt-4o
          provider: openai
          modelId: gpt-4o
          priority: 1
```

### 健康检查

```bash
# 查看状态
docker compose ps

# 健康检查
docker compose exec phus phus health
```

容器内置 `HEALTHCHECK`，每 30 秒执行一次 `phus health`。

---

## systemd

适用于 VPS 或裸机部署。

### 1. 安装

```bash
git clone <repo-url> /opt/phus
cd /opt/phus
npm ci --omit=dev
npm run build

# 创建用户和目录
sudo useradd --system --shell /usr/sbin/nologin --home /var/lib/phus phus
sudo mkdir -p /var/lib/phus /var/log/phus
sudo chown -R phus:phus /var/lib/phus /var/log/phus /opt/phus
```

### 2. 配置密钥

```bash
sudo mkdir -p /etc/phus
sudo tee /etc/phus/phus.env > /dev/null <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
EOF
sudo chmod 600 /etc/phus/phus.env
```

### 3. 安装服务

```bash
sudo cp deploy/phus.service /etc/systemd/system/phus.service
sudo systemctl daemon-reload
sudo systemctl enable --now phus
sudo systemctl status phus
```

### 4. 运维

```bash
# 查看日志
sudo journalctl -u phus -f
sudo tail -f /var/log/phus/phus.jsonl

# 重启
sudo systemctl restart phus

# 健康检查
phus health
```

---

## Docker + LiteLLM

适用于需要成本监控或多人使用的场景。

### LiteLLM 提供的额外能力

| 功能 | Phus Mesh | LiteLLM |
|---|---|---|
| 跨 Provider  Failover | ✅ | ✅ |
| 熔断器 | ✅ | ✅ |
| 每人独立 API Key | ❌ | ✅ |
| 成本 Dashboard | ❌ | ✅ |
| 缓存 | ❌ | ✅ |

### 配置

项目已提供 `deploy/litellm-config.yaml`：

```bash
docker compose -f docker-compose.litellm.yml up -d
```

访问 `http://localhost:4000` 查看成本仪表板。

### 何时使用 LiteLLM

- ✅ 多用户共享，每个用户有独立 Key
- ✅ 需要成本控制和仪表板
- ✅ 需要跨用户缓存

### 何时不用 LiteLLM

- ❌ 单用户、单实例 → Phus Mesh 足够
- ❌ 需要最小化运维复杂度
- ❌ 离线/气隙环境

---

## Gateway 服务安装

Phus 支持将自身安装为系统服务：

```bash
# 安装服务
phus gateway install

# 启停管理
phus gateway start
phus gateway stop
phus gateway restart
phus gateway status

# 卸载
phus gateway uninstall
```

- **Linux**: 创建 `~/.config/systemd/user/phus.service`
- **macOS**: 创建 `~/Library/LaunchAgents/dev.phus.gateway.plist`

---

## 健康检查

```bash
phus health
```

检查项：

| 检查项 | 通过条件 |
|---|---|
| `tape_db` | SQLite 文件存在 |
| `skills_dir` | Skills 目录存在 |
| `provider_key` | 至少配置了一个 API Key |
| `log_file` | 日志文件可写 |

退出码：`0` = 健康，`1` = 不健康。

### Docker HEALTHCHECK

```yaml
services:
  phus:
    healthcheck:
      test: ["CMD", "phus", "health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### systemd Watchdog

`phus.service` 已配置 `Restart=on-failure`，systemd 会自动重启崩溃的进程。

---

## 优雅关闭

Docker (`docker stop`) 和 systemd (`systemctl stop`) 发送 SIGTERM。Phus 会：

1. 关闭所有活跃 Channel
2. 等待进行中的请求完成
3. 写入最终状态到 Tape
4. 退出 0

如果 10 秒内未完成，发送 SIGKILL 强制终止。

---

## 更新

```bash
# Docker
git pull
docker compose build
docker compose up -d

# systemd
cd /opt/phus
git pull
npm ci --omit=dev
npm run build
sudo systemctl restart phus
```

Tape、Skills、Plugins 保存在 `$PHUS_HOME`，更新不会丢失。

---

## 资源需求

Phus 本身很轻量（空闲时 ~50MB RSS）。主要消耗：

- **Pi Agent 消息缓冲区** — 随对话长度增长
- **SQLite WAL** — 自动检查点，不会无限增长
- **LLM Context** — 由选择的模型决定

| 使用场景 | 推荐内存 |
|---|---|
| 单通道、低频使用 | 256 MB |
| 高吞吐、多通道 | 1 GB+ |

---

## 相关

- [配置参考](./configuration)
- [发布体系](./release)
