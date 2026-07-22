# phus health

健康检查，用于 Docker HEALTHCHECK 或 systemd watchdog。

```bash
phus health [选项]
```

## 选项

| 选项 | 说明 |
|---|---|
| `--json` | JSON 格式输出 |

## 检查项

- ✅ SQLite 连接
- ✅ Tape 可写
- ✅ Skills 目录存在
- ✅ 配置文件有效
- ✅ 至少一个 Provider 配置了 API Key

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 健康 |
| 1 | 不健康 |

## 示例

```bash
# Docker HEALTHCHECK
HEALTHCHECK --interval=30s --timeout=10s CMD phus health

# systemd watchdog
ExecStartPost=/usr/bin/phus health || systemctl restart phus
```

## 相关

- [部署](../guide/deployment)
