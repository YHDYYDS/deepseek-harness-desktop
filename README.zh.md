<p align="center">
  <img src="apps/desktop/build/icon.png" width="96" alt="DeepSeek Harness 桌面版" />
</p>

<h1 align="center">DeepSeek Harness 桌面版</h1>

<p align="center">
  <strong>DeepSeek Harness 的 Windows 原生应用 —— 双击即用，无需 Node、无需命令行。</strong><br />
  与官方 Web/CLI 共享同一份会话与凭据，还顺手根治了上游的会话日志损坏 bug。
</p>

<p align="center">
  <a href="https://github.com/YHDYYDS/deepseek-harness-desktop/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/YHDYYDS/deepseek-harness-desktop?include_prereleases&style=flat-square&color=4d6bfe" /></a>
  <a href="https://github.com/YHDYYDS/deepseek-harness-desktop/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/YHDYYDS/deepseek-harness-desktop?style=flat-square&color=4d6bfe" /></a>
  <img alt="平台" src="https://img.shields.io/badge/Windows-10%2F11%20x64-4d6bfe?style=flat-square" />
  <a href="LICENSE"><img alt="许可：MIT" src="https://img.shields.io/badge/License-MIT-4d6bfe?style=flat-square" /></a>
</p>

> **一句话**：把 DeepSeek Harness 完整的 Web 体验（模型路由、工具、沙箱、会话、四个 Agent 预设）打包成一个原生 Windows 应用——不是"浏览器套壳"，而是把整个宿主引擎**原生内嵌**进 Electron 主进程。

[English](README.md)

## 为什么是这个壳，而不是别的

| 维度 | 本项目 | 常见社区壳 |
|---|---|---|
| 宿主载体 | **主进程原生内嵌**（`runProfile` 直启 Cordis 上下文） | spawn `dsh web` 子进程 + 解析 stdout 端口 |
| 进程模型 | 单进程树，无第二个 Node/V8 | Electron(壳) + dsh(子进程) 双运行时 |
| 环境依赖 | 零依赖：目标机器不需要 Node/pnpm/dsh | 部分需要系统 Node，或靠内置 node.exe 绕行 |
| 崩溃恢复 | 健康检查 + 异常双触发，**限次自动重建宿主** | 多数仅杀进程了事 |
| 质量门禁 | **打包后冒烟测试进 CI**（验证 `__DSH_BOOT__` 真实注入） | 少数有 |
| 上游贡献 | **已修复上游会话日志损坏 bug**（含回归测试，PR 分支备好） | 无 |
| 体积 | 安装包 ~139MB，安装后 ~700MB（asar 关闭，实文件布局） | 视方案而定 |

**内核级差异**：多数壳把 harness 当黑盒子子进程管；本项目在开发途中直接触发了上游一个真实数据损坏 bug（两个宿主并发冷启动、对同一中断会话重复写收尾事件 → seq 重复 → "seq gap in committed region"），并把[根治修复 + 回归测试](https://github.com/YHDYYDS/deepseek-harness-desktop/commit/9540305481)送回了上游代码库，[PR 分支](https://github.com/YHDYYDS/deepseek-harness/tree/fix/session-repair-seq-race)已备好等官方开放。壳好做，看得懂内核才修得了这种 bug。

## ✨ 特性

- 🚀 **双击即用**：内置 Electron 运行时（Node 22）与全部 Harness 插件，免安装环境依赖
- 🪟 **启动加载页**：冷启动有品牌加载页 + 实时状态，不再是"点了没反应"
- 🛡️ **崩溃自愈**：宿主失联自动重建（10 分钟内限 3 次），弹错误框也不会静默装死
- 🔗 **与官方完全互通**：共享 `~/.dsh` 的会话、设置、API Key 与四个 Agent 预设（标准 / PTC / 极简 / 创造），和 `dsh web` 交替使用零迁移
- 🔒 **本机安全**：宿主仅绑定 `127.0.0.1` 随机端口；渲染进程完全沙箱化，禁止离源导航与弹窗
- 🐋 **单实例 + 优雅退出**：重复启动聚焦已有窗口；关闭后宿主完整关停、端口释放
- ✅ **CI 冒烟门禁**：每次 release 构建自动跑打包产物冒烟测试（一次性临时数据目录、验完即杀）

## 📦 下载（Windows 10/11 x64）

| 版本 | 说明 | 下载 |
|---|---|---|
| **安装版（推荐）** | NSIS 安装向导，装一次后秒开 | [最新 Release](https://github.com/YHDYYDS/deepseek-harness-desktop/releases/latest) |
| **便携版** | 免安装；但每次启动需自解压 ~660MB，首启较慢 | 同上 Release 页 `-portable.exe` |

所有版本都在 [Releases 页面](https://github.com/YHDYYDS/deepseek-harness-desktop/releases)。首次启动按界面引导配置**你自己的 DeepSeek API Key**（凭据仅存本机 `~/.dsh`，绝不随应用分发）。

## 🖥️ 使用

1. 安装后从开始菜单启动。
2. 加载页 → 进入完整 Harness 界面。
3. 已装过 CLI/Web 的用户直接继承一切——会话、设置、预设完全一致。
4. 关闭窗口即优雅退出（宿主关停、端口释放）。

## 🔧 开发者

```bash
pnpm install && pnpm run build                # 前置：各包 lib + apps/web dist

pnpm --filter @deepseek-ai/dsh-desktop run start           # 开发运行
pnpm --filter @deepseek-ai/dsh-desktop run dist            # nsis + portable 打包
pnpm --filter @deepseek-ai/dsh-desktop run smoke:packaged  # 打包后冒烟测试
```

推送 `v*` tag 触发 `.github/workflows/desktop-release.yml`：构建 → **冒烟测试** → 挂附件到 Release。

打包采用 `asar: false`（VS Code 同型布局）：harness 深度依赖真实文件路径（profile 符号链接、worker 脚本、koffi FFI、ESM 入口），asar 会系统性破坏这些路径。入口是 CJS 引导 `main.cjs`（Electron 无 Node 内部 ESM loader，需先注册 `@deepseek-ai/*` 解析兜底）。

完整设计笔记见 [apps/desktop/README.md](apps/desktop/README.md) 与 [apps/desktop/DESIGN.md](apps/desktop/DESIGN.md)。

## 🔒 安全模型

- 宿主仅绑定 `127.0.0.1` + OS 分配随机端口；无 `--host 0.0.0.0`、无 `--trusted-host`。
- renderer 完全沙箱化（`contextIsolation` + `sandbox`，无 Node、无 preload）；禁止弹窗与离源导航。
- 加载页 CSP 收紧至无外部资源。
- 与 `dsh web` 相同：loopback API 无认证（本机任意进程可调）——桌面形态不新增攻击面、也不改变它。
- 冒烟测试使用一次性临时 `DSH_HOME`，绝不触碰真实会话数据。

## ⚠️ 已知限制

- **未做代码签名**：SmartScreen 会提示"未知发布者"→ 更多信息 → 仍要运行。
- **仅 Windows x64**；macOS/Linux 未构建。
- **无自动更新**：新版请从 Releases 下载覆盖安装。
- 便携版每次启动需自解压 ~660MB；日常使用请用安装版。
- 安装后占用约 700MB（`asar: false` 实文件布局换来的稳定性）。

## 📜 许可与声明

本应用是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**非官方社区构建**，与 DeepSeek 官方无隶属关系；名称与鲸鱼 logo 为 DeepSeek 商标，仅作标识用途。代码基于 MIT 协议的 harness 代码库（含上游会话持久化修复），新增桌面代码同为 MIT。安装包连带捆绑部分第三方 CLI 二进制（Codex、Claude Code 等 subagent 提供方），公开发布前请自行核查其使用条款。
