# Phus CLI/TUI 用户体验改进

> 目标：让 `phus` 在没有配置 API key 时也能启动，并引导用户完成配置，而不是直接 crash。

---

## 1. 当前问题

运行 `pnpm run dev`（即 `phus` 默认命令）时，如果未设置 `ANTHROPIC_API_KEY` 等 provider key，会在启动阶段抛出：

```
Error: Profile "default" has no API key. Set the environment variable:
  export ANTHROPIC_API_KEY=<your-key>
```

错误栈定位：

- `src/phus.ts:27` → `registerPluginCliCommands`
- → `PhusAgent.create` → `buildDefaultPhusAgentDeps`
- → `resolveModel()` 在 `src/bridge/model-resolver.ts:40` 直接 throw

这导致：

1. 用户第一次安装后无法看到任何界面。
2. `phus setup`、`phus help` 等本不需要 key 的命令也跑不起来。
3. 错误信息对新手不友好，没有告诉他们可以运行 `phus setup`。

---

## 2. 设计原则

1. **启动不依赖 key**：CLI 程序构建、help、`phus setup` 等命令应能在无 key 时正常执行。
2. **按需报错**：只有真正要调用 LLM 的命令（`phus run`、gateway）才需要 key；此时给出友好提示。
3. **引导式配置**：默认 `phus` 命令在没有配置时启动 TUI setup wizard，而不是 crash。
4. **保持向后兼容**：已有 key 的用户体验不变。

---

## 3. 改动点

### 3.1 让模型解析不阻断启动

文件：`src/bridge/model-resolver.ts`

- 新增 `resolveModelSafe(): { model: Model; missingKey?: string }`
- `resolveModel()` 保持原行为（向后兼容），但在启动路径中不再被直接调用。
- `buildDefaultPhusAgentDeps` 改用 `resolveModelSafe`，并新增 `allowMissingKey` 选项；只设置存在的 key，不 throw。

### 3.2 延迟检查 API key

文件：`src/bridge/pi-agent.ts`

- `PhusAgent.create` 默认 `allowMissingKey: true`，不因为 missing key 失败。
- 新增 `assertModelReady()`：在真正需要 LLM 调用前检查 key，给出友好错误并提示 `phus setup`。
- `turn()` 开头调用 `assertModelReady()`。

### 3.3 plugin CLI 注册容错

文件：`src/cli/program.ts`

- `registerPluginCliCommands` 中 `PhusAgent.create` 失败时（包括 missing key），捕获并记录 warn，继续注册命令。
- 内部命令 `initInternalCommands` 只在 agent 创建成功时执行。

### 3.4 默认命令/TUI 无 key 引导

文件：`src/tui/index.ts`

- `startTui()` 启动前检查当前 profile 是否配置了有效 key。
- 如果没有配置文件，启动 `BootstrapWizard` 引导用户配置 provider/model/key。
- BootstrapWizard 会把用户输入的 API key 直接写入 `phus.config.yaml` 的 `apiKey` 字段，确保第一次运行即可使用。
- 若配置已存在但 key 仍缺失，给出明确的 env var / 编辑配置提示，不再重复启动 wizard 造成循环。

### 3.5 run/gateway 友好错误

文件：`src/cli/commands/run.ts`、`src/cli/commands/gateway.ts`

- 这些命令执行前检查 active profile 的 API key。
- 缺失时打印并退出：
  ```
  No API key configured for profile "default".
  Run `phus setup` to configure a provider and key, or set:
    export ANTHROPIC_API_KEY=<your-key>
  ```

### 3.6 setup 命令可独立运行

文件：`src/cli/commands/setup.ts`

- `phus setup` 不依赖 `PhusAgent` 创建成功，可直接运行。

---

## 4. 关键函数设计

### `resolveModelSafe`

```typescript
export function resolveModelSafe(): { model: Model; missingKey?: string } {
  const profileName = loadConfig().profileName;
  const profile = resolveProfile(profileName);
  const model = modelFromProfile(profile);
  const key = apiKeyForProfile(profile);

  if (key) {
    const provider = profile.provider;
    if (provider) {
      process.env[providerApiKeyEnvVar(provider)] ??= key;
    }
    return { model };
  }

  const provider = profile.provider;
  const missingKey = profile.apiKeyEnv
    ? profile.apiKeyEnv
    : provider
      ? providerApiKeyEnvVar(provider)
      : "<PROVIDER>_API_KEY";
  return { model, missingKey };
}
```

### `assertModelReady`

```typescript
assertModelReady(): void {
  const key = apiKeyForProfile(this.profile);
  if (key) return;

  const envVar = this.profile.apiKeyEnv
    ? this.profile.apiKeyEnv
    : `${this.profile.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  throw new Error(
    `No API key configured for profile "${this.profile.name}".\n` +
      `Run \`phus setup\` to configure a provider and key, or set:\n` +
      `  export ${envVar}=<your-key>`,
  );
}
```

---

## 5. 验收标准

- [x] `pnpm run dev` 在无 key 时不 crash，而是进入 setup wizard 或提示运行 `phus setup`。
- [x] `phus setup`、`phus --help`、`phus --version` 在无 key 时能正常运行。
- [x] `phus run "hello"` 在无 key 时给出友好错误并提示 setup。
- [x] `phus gateway` 在无 key 时给出友好错误并提示 setup。
- [x] 已配置 key 的用户体验完全不变。
- [x] 新增/更新测试覆盖无 key 启动路径。
- [x] `pnpm typecheck` 和 `pnpm test` 全部通过。
