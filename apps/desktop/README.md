# @deepseek-ai/dsh-desktop

DeepSeek Harness 桌面壳：宿主（完整 web 组合）运行在 Electron 主进程内，单一进程树，无需本机安装 Node/`dsh`。设计见 [DESIGN.md](./DESIGN.md)。

## 前置条件

- 仓库根已执行 `pnpm install` 且 `pnpm run build` 完成（需要 `apps/web/dist` 与各包 `lib` 产物）。
- Electron ≥ 39（内置 Node ≥ 22.19，启动时另有运行时断言）。

## 运行（开发）

```bash
pnpm --filter @deepseek-ai/dsh-desktop run start
```

## 打包

```bash
pnpm --filter @deepseek-ai/dsh-desktop run pack   # 目录版（调试用）
pnpm --filter @deepseek-ai/dsh-desktop run dist   # nsis + portable 安装包
```

国内网络建议设置镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
```

打包采用 `asar: false`（整体解包）：harness 宿主依赖真实文件系统路径（profile 扁平回退的符号链接、workflow/worker 脚本、koffi FFI、ESM 入口），asar 会系统性破坏这些路径，且收益（压缩）对 200MB 级 node_modules 不划算。入口是 CJS 引导 `main.cjs`：它先注册 `@deepseek-ai/*` 的 ESM 解析兜底（Electron 无 Node 内部 loader），再加载真路径的 ESM 主体。

## 分发与测试（把应用发给朋友）

1. 把 `dist\DeepSeek Harness-0.1.0-rc.5-portable.exe`（免安装，单文件）发给对方，或经 GitHub Releases 下载（push `v*` tag 触发 `.github/workflows/desktop-release.yml` 自动构建并挂附件）。
2. 对方双击运行即可，无需安装 Node。**对方需要自己的 DeepSeek API Key**（首次启动按界面引导配置；凭据只存于对方的 `~/.dsh`，不会随应用分发）。
3. 应用未做代码签名：Windows SmartScreen 会提示"未知发布者"，点"更多信息 → 仍要运行"。portable 首次启动自解压约 660MB，可能耗时数分钟（Defender 扫描）。
4. 发送前请确认对方是 Windows x64。

## 合规与声明

- 本应用是 **DeepSeek Harness 的非官方社区构建**，与 DeepSeek 官方无隶属关系；DeepSeek 名称与鲸鱼 logo 为 DeepSeek 的商标，仅作标识用途。
- 代码基于 MIT 协议的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 修改（保留 [LICENSE](../../LICENSE) 与 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)）；本应用新增代码同为 MIT。
- 注意：安装包会连带捆绑部分第三方 CLI 二进制（OpenAI Codex、Claude Code 等，来自宿主平面的 subagent 提供方）。**公开分发前请核查其各自使用条款**——朋友间小范围测试无碍，公开发布建议评估是否剔除（在 electron-builder.yml 的 `files` 中排除对应 node_modules 路径）并自行确认可行性。

## 安全模型

- 宿主仅绑定 `127.0.0.1` + OS 分配的随机端口；不暴露 `--host` / `--trusted-host`。
- renderer 完全沙箱化（`contextIsolation` + `sandbox`，无 Node、无 preload），禁止弹出窗口与离源导航。
- 与 `dsh web` 共享同一 `$DSH_HOME`（会话、设置、凭据、预设互通）。loopback API 无认证的事实与 `dsh web` 相同。

## 验收清单

- [x] 启动后窗口显示 Harness UI；模型/会话与 `dsh web` 一致（`__DSH_BOOT__` 38 个 client 插件、bundle 200）
- [x] 关闭窗口后进程退出，无残留端口监听（`win-unpacked` 与 portable 均实测）
- [x] 打包产物在无 Node 环境可运行（Electron 内置 Node 22.22.1 满足 engines）
- [ ] 与 `dsh web` 交替使用同一 `$DSH_HOME` 无数据损坏（共享同一存储，理论同语义；未做长时压测）
- [x] 无 `--host 0.0.0.0`、无 `--trusted-host` 暴露面；renderer 保持沙箱

已知事项：portable 版首次启动需自解压约 660MB（2.7 万个文件，Windows Defender 实时扫描会使首次启动耗时数分钟），之后启动恢复秒级；asar 关闭（见上）因此安装目录体积较大（约 139MB 安装包，安装后约 700MB）。
