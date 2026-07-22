# phus skills

列出已安装的 Skills。

```bash
phus skills [选项]
```

## 选项

| 选项 | 说明 |
|---|---|
| `--json` | JSON 格式输出 |
| `--name <name>` | 查看指定 Skill 详情 |

## 输出示例

```
📦 Installed Skills (6)

  skill-name        v1.0.0  by human
  summarize-last    v1.0.0  by agent
  ppt-craft         v0.1.0  by phus
  sisyphus-expl      v0.1.0  by phus
  respond-concise    v1.0.0  by human
  commit-message     v1.0.0  by human
```

## Skill 存储位置

Skills 保存在 `$PHUS_SKILLS_DIR`（默认 `~/.phus/skills`）。

## 相关

- [插件开发](../plugins/)
