# Phus 发布体系

> 目标：建立可自动化的版本发布流程，覆盖 CI、npm、GitHub Releases、Docker 镜像和安装脚本分发。

---

## 1. 发布体系组成

| 组件 | 作用 | 触发方式 |
|---|---|---|
| **CI Workflow** | PR / push 时跑 typecheck + lint + test + build | `.github/workflows/ci.yml` |
| **Release Workflow** | 打 tag 时自动发布 npm + GitHub Release + Docker | `.github/workflows/release.yml` |
| **Version Bump Script** | 本地一键升级版本号、生成 changelog、打 tag | `scripts/release.sh` |
| **Docker 构建** | 多阶段构建，推送到 GHCR | `Dockerfile` + workflow |
| **npm 发布** | 发布 `phus` 包到 npm registry | workflow 中 `npm publish` |
| **GitHub Releases** | 自动生成 release notes + 上传构建产物 | workflow 中 `gh release create` |
| **安装脚本** | 从 GitHub Releases 下载预构建产物 | `scripts/install.sh` / `install.ps1` |

---

## 2. 版本策略

采用 **Semantic Versioning**（`MAJOR.MINOR.PATCH`），预发布版本用 `-beta.N` / `-alpha.N`：

- `v0.1.0` — 稳定版
- `v0.2.0-beta.1` — 预发布版
- 通过 git tag 触发 release workflow

### 发布通道

| 通道 | Tag 模式 | npm dist-tag | Docker tag |
|---|---|---|---|
| stable | `v0.1.0` | `latest` | `latest`, `0.1.0` |
| beta | `v0.2.0-beta.1` | `beta` | `beta` |
| dev | 手动触发 | `dev` | `dev` |

---

## 3. CI Workflow

文件：`.github/workflows/ci.yml`

触发条件：
- `push` 到 `main`
- `pull_request` 到 `main`

任务：
1. Checkout
2. Setup Node 20 + pnpm
3. `pnpm install`
4. `pnpm typecheck`
5. `pnpm lint`
6. `pnpm test`
7. `pnpm build`

---

## 4. Release Workflow

文件：`.github/workflows/release.yml`

触发条件：
- `push` tag `v*`

任务：

### 4.1 基础检查
- 跑 CI 全套（typecheck / lint / test / build）

### 4.2 npm 发布
- 读取 `package.json` version
- `npm publish --access public`
- 稳定版 tag 为 `latest`，beta/alpha tag 为 `beta`/`alpha`

### 4.3 GitHub Release
- 使用 `gh release create ${{ github.ref_name }}`
- 自动生成 release notes（基于 PR 标题）
- 上传 `dist/` 目录为 zip / tarball

### 4.4 Docker 镜像
- 登录 GitHub Container Registry (`ghcr.io`)
- 构建并推送：
  - `ghcr.io/phus/phus:latest`（稳定版）
  - `ghcr.io/phus/phus:<version>`
  - `ghcr.io/phus/phus:beta`（beta 版）

---

## 5. 本地发布脚本

文件：`scripts/release.sh`

用法：
```bash
./scripts/release.sh patch   # 0.1.0 -> 0.1.1
./scripts/release.sh minor   # 0.1.0 -> 0.2.0
./scripts/release.sh major   # 0.1.0 -> 1.0.0
./scripts/release.sh 0.3.0   # 指定版本
```

流程：
1. 确保当前分支是 `main`，工作区干净
2. 读取或计算新版本号
3. 更新 `package.json` version
4. 更新 `CHANGELOG.md`（追加版本小节）
5. `git add package.json CHANGELOG.md`
6. `git commit -m "release: v<version>"`
7. `git tag v<version>`
8. `git push origin main --tags`
9. GitHub Actions 接管后续发布

---

## 6. Changelog

文件：`CHANGELOG.md`

格式（Keep a Changelog）：
```markdown
# Changelog

## [0.2.0] - 2026-07-17

### Added
- Long-horizon task execution (Phase 1)
- Self-evolution loop (Phase 2)
- Deployment and distribution (Phase 3)
```

`scripts/release.sh` 在发布时自动追加一个版本小节（从 git log 提取）。

---

## 7. 安装脚本升级

当前 `scripts/install.sh` 和 `install.ps1` 通过 `git clone` 安装源码并本地构建。改为：

1. 从 GitHub Releases API 获取最新 release（或指定 `PHUS_VERSION`）
2. 下载对应平台的预构建 tarball / zip（包含 `dist/` 和 `node_modules`）
3. 解压到 `$PHUS_HOME`
4. 创建 `phus` 可执行文件符号链接

这样新用户可以在 30 秒内完成安装，无需 Node/pnpm 工具链。

### 构建产物格式

每个 release 上传：
- `phus-<version>.tgz` — npm package（`npm pack` 输出）
- `phus-<version>-linux-x64.tar.gz` — 预构建 Linux 包
- `phcr.io/phus/phus:<version>` — Docker 镜像

---

## 8. npm 包配置

确保 `package.json` 包含：
```json
{
  "files": ["dist", "LICENSE", "README.md"],
  "publishConfig": {
    "access": "public"
  }
}
```

---

## 9. 安全与 Token

需要的 GitHub Secrets：

| Secret | 用途 |
|---|---|
| `NPM_TOKEN` | npm 发布 |
| `GHCR_TOKEN` 或 `GITHUB_TOKEN` | Docker 推送到 GHCR |
| `GITHUB_TOKEN` | 创建 GitHub Release |

---

## 10. 实施步骤

1. 添加 `.github/workflows/ci.yml`
2. 添加 `.github/workflows/release.yml`
3. 添加 `scripts/release.sh`
4. 初始化 `CHANGELOG.md`
5. 更新 `package.json` files/publishConfig
6. 更新 `scripts/install.sh` / `install.ps1` 从 release 下载
7. 更新 `documents/Deployment.md` 说明发布流程
8. 跑一遍 `pnpm typecheck && pnpm test && pnpm build` 验证

---

## 11. 验收标准

- [ ] PR/push 到 main 自动跑 CI
- [ ] 推送 `v*` tag 自动发布 npm + GitHub Release + Docker
- [ ] `./scripts/release.sh patch` 能本地完成版本升级并推送 tag
- [ ] 安装脚本能从 GitHub Release 下载并运行
- [ ] `CHANGELOG.md` 随版本自动更新
- [ ] 所有现有测试继续通过
