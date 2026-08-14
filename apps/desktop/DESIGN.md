# apps/desktop 设计蓝图 — Electron 深度集成（路线 C，C2 内嵌式优先）

Status: proposed — 蓝图 v1，2026-08-14

## 1. 目标与范围

把 DeepSeek Harness Web GUI 打包成桌面应用（Windows 优先，macOS/Linux 后续）。

- **路线 C**：宿主（harness host）运行在 Electron 主进程内——单进程树、不依赖用户机器上安装的 `dsh`/Node。
- **v1 载体 = C2 内嵌式**：主进程内启动完整 web 组合（含 webserver），绑定 `127.0.0.1` + OS 分配的随机端口，BrowserWindow 同源加载。零协议/客户端改动。
- **v2 载体 = C3 纯 IPC（可选阶段）**：不挂 webserver，渲染进程用 IPC 桥替换 `doFetch`。架构缝已全部预留（`AbstractApiClient`、`InProcessApiClient`、`toFetchHandler`、`injectBootManifest`），是纯增量替换。
- **模型/预设/会话零迁移**：宿主读同一个 `$DSH_HOME`，用户现有的 `deepseek-official / deepseek-v4-pro / reasoningEffort: max`、标准模式默认预设、历史会话与凭据自动继承。

## 2. 依据的关键事实（源码索引）

| 事实 | 位置 | 用途 |
|---|---|---|
| `runProfile()` 是程序化启动入口（profile 解析、用户补丁层、telemetry 开关、shipped preset roots、HMR watcher、fail-loud、有界关闭） | `apps/cli/src/profile-boot.ts` | Electron 主进程直接调用 |
| `loadLayeredEnv('dsh')` 构造 LaunchEnvironmentSnapshot | `@deepseek-ai/dsh-app-boot`（`apps/cli/src/bin.ts` 用法） | runProfile 的 environment 参数 |
| web 组合解析 `--port 0` 为 OS 分配端口；`--host 0.0.0.0` 有意拒绝 | `packages/bundle/web-app/src/startup.ts` | 随机端口 + 仅 loopback 的安全基线 |
| `WebServer` 服务暴露实际监听端口（`get port()`） | `packages/host/webserver/src/index.ts` | 启动后取真实端口拼 URL |
| profile 解析在 `$DSH_HOME/profiles/<name>`；缺失时按 `PROFILE_TEMPLATES` 自动初始化（`web` = `dsh-base` + `dsh-web-app`）；bundle 目录**安装锚点优先**（`apps/cli/package.json`），profile 目录为第二锚点 | `packages/boot/app-boot/src/profile.ts` | profile 目录在用户主目录（包外、可写），随桌面应用自然可用；bundle 必须随 app 的 node_modules 打包 |
| `prepareProfile()` 每次启动重写 profile 根 `cordis.yml`（Loader 需要真实 include 根） | `apps/cli/src/profile-boot.ts:98` | 写目标是 `$DSH_HOME`（包外）→ 无 asar 只读问题 |
| 前端 dist 由 `frontend-static` 服务，`__DSH_BOOT__` 与 `/plugins/*` bundle 由 `client-modules` 注入/路由 | `packages/host/frontend-static`、`packages/client/modules` | 前端产物只读，Electron 主进程 fs 读 asar 内文件透明 |
| v2 预留：进程内 fetch 载体与 handler 桥 | `packages/host/apiproxy`（`InProcessApiClient`、`toFetchHandler`） | v2 IPC 桥的复用点 |
| engines `node ^22.19.0 || >=24.0.0` | 根 `package.json` | Electron 内置 Node 版本约束（见 §10 风险 1） |
| Electron 39 内置 Node 22.20（38=22.18，不满足） | [Electron 39.0.0 发布说明](https://www.electronjs.org/blog/electron-39-0) | **选型下限：Electron ≥ 39**；启动时用 `process.versions.node` 断言（待 P0 落实） |
| Windows 原生目录选择器经 `koffi`（FFI）；workflow 用 `worker_threads` | `packages/host/directory-picker-native`、`packages/core/tools`（workflow） | asar 打包摩擦点（§8） |

## 3. 总体架构

```
┌─ Electron 主进程 ─────────────────────────────────┐
│  main.ts（单实例锁、生命周期）                      │
│    └─ runProfile({ profile:'web', args:['--port','0'] })   ← 完整 web 组合
│         ├─ webserver @ 127.0.0.1:<OS 分配端口>      │
│         ├─ 前端静态 + __DSH_BOOT__ 注入             │
│         └─ 全部宿主服务（会话/工具/LLM/沙箱…）        │
│    └─ BrowserWindow ─ loadURL(http://127.0.0.1:<port>)   │
│         renderer：sandbox + contextIsolation，无 Node   │
└───────────────────────────────────────────────────┘
              ↕ 同一 $DSH_HOME（会话/设置/凭据/预设）
       与 `dsh web` 完全互通
```

与 `dsh web` 的唯一差异：进程是 Electron 而非 Node CLI；组合、profile、数据完全一致。

## 4. 目录结构

```
apps/desktop/
  package.json        # electron(devDep) + @deepseek-ai/dsh(dep, workspace:*) + scripts
  src/main.ts         # 入口：单实例锁 → host 启动 → 窗口
  src/host.ts         # runProfile 封装 + 端口解析 + 启动失败诊断
  src/window.ts       # BrowserWindow 工厂（安全配置）
  src/lifecycle.ts    # before-quit → shutdown 编排（防重入）
  build/              # electron-builder 配置 + 图标
  DESIGN.md           # 本蓝图
  README.md           # 构建/运行/验收说明
```

workspace 接入：`pnpm-workspace.yaml` 增加 `apps/desktop`；依赖 `@deepseek-ai/dsh@workspace:*`（其传递依赖携带全部 `dsh-*` bundle 包）。

## 5. 启动时序

1. `app.requestSingleInstanceLock()`；拿不到 → 通知既有实例 focus → 退出。
2. `app.whenReady()` → `loadLayeredEnv('dsh')` → `runProfile({ environment, profile: 'web', patchFiles: [], args: ['--port', '0'] })`。
3. boot 稳定后：`ctx.get('webServer').port` → `url = http://127.0.0.1:${port}`。
4. 创建 `BrowserWindow`（`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、无 preload）。
5. `loadURL(url)`；`ready-to-show` 后再 `show()`（避免白屏闪烁）。
6. 失败路径：runProfile 抛错 → `dialog.showErrorBox`（带诊断文本）→ `app.exit(1)`。

## 6. 生命周期与关闭

- `before-quit` → `await lifecycle.shutdown()`：`shutdown.shutdown()`（fiber dispose + webserver close + watcher 拆除）；用一次性标记防重入。
- `runProfile` 注册的 SIGINT/SIGTERM 处理在 Windows/Electron 下无害，保留。
- HMR watcher（`watchUserPatches`）继续生效：用户在 `$DSH_HOME/cordis.patch.yml` 的编辑对桌面应用热生效——免费获得的既有特性。
- `window-all-closed` → `app.quit()`（Windows 惯例；macOS 走常规 activate 语义时再调整）。
- 验收点：退出后无残留子进程、无残留端口监听（P1 测试）。

## 7. 安全模型

- 仅 loopback 绑定：args 固定 `--port 0`，不向用户暴露 `--host`/`--trusted-host`。
- renderer 完全沙箱化（sandbox + contextIsolation、无 Node、无 preload）。
- 不加载任何远程内容；CSP 沿用现有前端产物。
- 与 `dsh web` 相同的事实要写明：loopback API 无认证，本机任意进程可调——桌面形态不新增攻击面，也不改变它。
- 单实例锁只约束桌面应用自身；与同时运行的 `dsh web` 共享 `$DSH_HOME` 的行为与两个 web 实例并存时一致（P0 记录实测结论）。

## 8. 打包（electron-builder）

- **前置**：`pnpm run build`（各包 lib + `apps/web/dist`；当前 checkout 尚无 dist，P0 必须补上）。
- `files`：`src` 编译产物 + production node_modules（`@deepseek-ai/dsh` 及其传递依赖；`apps/web/dist` 以文件方式纳入）。
- `asarUnpack`：`koffi` 原生模块、workflow worker 脚本、任何 `.node`；清单在 P0 冒烟后定稿。
- profile 目录在 `$DSH_HOME`（包外）→ `prepareProfile` 的写路径天然可用；前端 dist 只读 → asar 内可读（Electron fs 透明）。
- 目标格式：`nsis`（安装版）+ `portable`（免安装版）。
- **构建期断言**：打包脚本检查 `process.versions.node` 满足 engines（`^22.19.0`），不满足则失败——防止 Electron 降级后静默带病。

## 9. 分阶段实施

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 事实核查 | Electron ≥39 锁定 + Node 断言；`pnpm run build` 全绿；确认 `@deepseek-ai/dsh` 的依赖面足以支撑 bundle 解析；frontend-static 的 dist 定位在打包布局下成立 | 0.5 天 |
| P1 MVP | workspace 接入 + `src/{main,host,window,lifecycle}.ts` + `electron .` 本地跑通（UI 加载、会话/模型与 `dsh web` 一致、退出无残留） | 1–2 天 |
| P2 打包 | electron-builder + asarUnpack + 图标 + nsis/portable 产出安装包；干净机器（无 Node）冒烟 | 1–2 天 |
| P3 打磨（可选） | 托盘、自动更新（electron-updater）、Electron 原生目录选择器（directory-picker seam 的 Electron provider） | 1 周内 |
| P4 纯 IPC 载体（可选） | `IpcApiClient`（doFetch 走 IPC + 双下行帧流走 IPC 事件）+ 主进程 `toFetchHandler` 桥 + 自定义 scheme 资源与 `__DSH_BOOT__` 注入 | 1–2 周 |

## 10. 风险清单与对策

| # | 风险 | 概率 | 对策 |
|---|---|---|---|
| 1 | Electron 内置 Node 低于 `^22.19.0`（如误选 38） | 高 | 锁 Electron ≥39；启动与打包双断言 `process.versions.node` |
| 2 | asar 与 `koffi`/`worker_threads` 不兼容 | 中 | P0 冒烟；`asarUnpack` 清单；必要时该两包整目录排除 |
| 3 | 前端 dist 缺失/过期 | 确定 | P0 先执行 `pnpm run build`，纳入打包前置 |
| 4 | `runProfile` 面向进程生命周期的假设（信号处理、exit 语义）与 Electron 不匹配 | 中 | `lifecycle.ts` 显式编排；若冲突不可调和，在 apps/desktop 内自建精简 boot（`prepareProfile` + `boot`，放弃 HMR watcher 即可） |
| 5 | pnpm 严格 node_modules 下 `resolveBundleDir` 从安装锚点解析不到 bundle | 中 | P0 验证 `@deepseek-ai/dsh` 的依赖面；必要时 apps/desktop 直接依赖 `dsh-base`/`dsh-web-app` |
| 6 | 双实例（desktop + dsh web）并发写 `$DSH_HOME` | 低 | 与两个 web 实例并存同语义；P0 实测记录，必要时文档化"不要同时开两个" |

## 11. 验收标准

1. `electron .`（开发）与打包产物（发布）启动后，窗口显示 Harness UI；模型、推理等级、会话历史与 `dsh web` 完全一致。
2. 关闭窗口 → 主进程退出，无残留 dsh 子进程、无残留端口监听。
3. 打包产物在无 Node/无 pnpm 的干净机器上双击可运行。
4. 与 `dsh web` 交替使用同一 `$DSH_HOME`，无数据损坏。
5. 无 `--host 0.0.0.0`、无 `--trusted-host` 暴露面；renderer 保持沙箱。

## 12. 待确认项（P0 逐一关闭）

- [x] Electron 39 精确内置 Node 版本 —— 网络受限未能直接核实发布说明；以启动时 `process.versions.node` 断言兜底（main.ts），Electron 锁 `^39.2.7`。
- [x] `loadLayeredEnv('dsh')` 在 Windows 双击启动（无 shell env）上下文下的行为 —— `DSH_HOME` 缺省回退 `~/.dsh`，与 `dsh web` 一致；运行时验证列入 P1 冒烟。
- [x] `ctx.get('webServer')` 的服务名与类型导出 —— 服务键为 `webServer`（`frontend-static`/`client-modules` 的 inject 数组），实例公开 `port` getter；host.ts 用结构化类型取用。
- [x] `shutdown.shutdown()` 在 boot 完成后可安全 await 的语义 —— `createProcessShutdown` 的 `shutdown(code)` 做幂等 dispose + 5s 强制退出兜底；lifecycle.ts 依此编排 `before-quit`。
- [x] `frontend-static` 的 dist 定位逻辑 —— dist 由 `dsh-web-app`（bundle 包）作为组装事实解析，前端产物随 `@deepseek-ai/dsh-web-frontend` 包进入 node_modules；打包布局验证列入 P2。

## 13. 实现期决策记录（2026-08-14）

- **`runProfile` 的公开导入面**：`apps/cli` 构建后 `lib/bin.js` 为 tsdown 打包入口（哈希分块），而 `lib/types/*.js` 是 tsc 产物（完整可运行实现 + .d.ts）。为避免依赖哈希分块名，在 `apps/cli/package.json` 增加了 exports 子路径：`@deepseek-ai/dsh/profile-boot` 与 `@deepseek-ai/dsh/process-shutdown`（types → `lib/types/*.d.ts`，default → `lib/types/*.js`），并把 `lib/types` 纳入 `files` 发布清单。该说明符与 `profile-boot.ts` 自身的 `@module` 注释一致。仓库内唯一深导入消费方是 apps/desktop，无兼容性破坏。
- **桌面包依赖面**：`@deepseek-ai/dsh`（传递携带全部 bundle 与 `dsh-web-frontend`）+ `@deepseek-ai/dsh-app-boot`（`loadLayeredEnv`）；`Context` 类型经 `Awaited<ReturnType<typeof runProfile>>` 派生，避免直接依赖 cordis。
- **打包摩擦点清单已落地**：electron-builder.yml 的 `asarUnpack` 覆盖 koffi、directory-picker-native（lib/worker.cjs）、workflow-worker-thread、code-runtime-worker-thread；`npmRebuild: false` 配合 pnpm 布局。

## 14. P1/P2 验证记录（2026-08-14，全部实证）

| # | 问题 | 根因 | 处置 |
|---|---|---|---|
| 1 | Electron 内置 Node 版本 | 39.8.10 → Node 22.22.1，满足 `^22.19.0` | 启动断言通过；无需特殊处理 |
| 2 | `runProfile` 的 `INSTALL_ANCHOR`/`SHIPPED_PRESET_ROOT` 在 `lib/types` 产物下解析错位（`../package.json` 落到 `apps/cli/lib/`） | tsc 把 profile-boot 发射到 `lib/types/`（两层深），原相对 URL 只对一层深的 tsdown 分块成立 | `apps/cli/src/profile-boot.ts` 改为 `findInstallAnchor()` 向上遍历找 `@deepseek-ai/dsh` 的 package.json；`SHIPPED_PRESET_ROOT` 由它派生。同时给 `apps/cli/package.json` 增加 exports 子路径 `./profile-boot`、`./process-shutdown`（`lib/types` 纳入 `files`）作为嵌入式宿主的公开消费面 |
| 3 | Electron 下 loader 全部插件 `Cannot find package` | Electron 无法访问 Node 内部 ESM loader（`node-addon-require-builtin` 摸不到 `internal/modules/esm/loader`），vendored loader 回退到裸 `import()`，从 vendor/loader 向上找不到 pnpm 严格布局下的包链接 | `apps/desktop/main.cjs`（CJS 引导，见 #5）注册同步 ESM resolve hook：`@deepseek-ai/*` 解析失败时改经 `$DSH_HOME/profiles/web` 锚点（命中扁平回退 `profiles/node_modules`）用 `createRequire` 兜底 |
| 4 | 启动后 `--expose-internals is required for HMR service` | profile-boot 无条件创建 watch-only HMR；HMR 需要 Node 内部 loader，Electron 永远提供不了 | `apps/cli/src/profile-boot.ts`：HMR 创建失败时降级为静态组合（记 warn、跳过 `watchUserPatches`）——config 热重载是便利项而非启动契约；CLI 行为不变 |
| 5 | 打包后主进程零输出（main 未执行） | Electron 不能从 app.asar 内加载 ESM 主入口；且 ESM 静态导入发生在任何代码运行之前，解包后裸导入够不到 asar 内 node_modules | 入口改为 CJS 引导 `main.cjs`（asar 内 CJS 可加载）：先注册 resolve hook（#3），再动态导入解包的真路径 `lib/main.js` |
| 6 | 打包后 `__DSH_BOOT__.entries` 为空（0 个 client 插件） | client-modules 注册表经 `$DSH_HOME/profiles/node_modules` 符号链接解析包路径，链接目标指向 asar 内部（真实 fs 不存在、realpath 失败） | **`asar: false`**：harness 深度依赖真实路径（符号链接、worker、koffi FFI、profile 配置），整体解包（VS Code 同型布局）一次性消除整类问题；打包后 38 个 client 插件全部注册、bundle 200 |
| 7 | pnpm 安装卡在 `@openai/codex` | npm 对该 131MB tarball 仅 ~4KiB/s；且 lockfile 完整性哈希对应旧发布（同版本重打包），镜像副本哈希不符 | 从镜像源取到 tarball 存入 store 后 `pnpm update @openai/codex` 让 pnpm 用注册表新完整性更新 lockfile；`pnpm-workspace.yaml` 的 `allowBuilds` 增补 `electron: true`（构建时经 `ELECTRON_MIRROR`） |
| 8 | electron-builder 二进制下载慢/失败 | GitHub 网络受限 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` + `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` |

**验证结论**：`dist/win-unpacked` 打包版实测——宿主在 Electron 主进程启动（随机回环端口），UI 完整（38 插件图、bundle 200、manifest 可用），窗口关闭 → 进程归零（优雅关停）。首次冷启动 ~40s（无 asar 的实文件冷读），后续启动显著更快。
