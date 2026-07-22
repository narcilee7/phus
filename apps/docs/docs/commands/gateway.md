# phus gateway

启动 Gateway 服务，支持 WebSocket 和 SSE 通道。

```bash
phus gateway [选项]
```

## 选项

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--websocket <port>` | 启用 WebSocket 通道 | - |
| `--sse <port>` | 启用 SSE 通道 | - |
| `--telegram` | 启用 Telegram 通道 | - |
| `--slack` | 启用 Slack 通道 | - |

## 示例

```bash
# 同时启用 WebSocket 和 SSE
phus gateway --websocket 8080 --sse 8081

# 启用 WebSocket + Telegram
phus gateway --websocket 8080 --telegram

# 生产环境建议使用 systemd
sudo systemctl enable --now phus
```

## WebSocket 客户端

连接 WebSocket 后发送 JSON 消息：

```typescript
const ws = new WebSocket('ws://localhost:8080');
ws.send(JSON.stringify({
  type: 'message',
  text: 'Hello Phus!'
}));
```

## 相关

- [部署](../guide/deployment)
- [通道配置](../guide/configuration#channels)
