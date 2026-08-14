<p align="center">
  <img src="apps/desktop/build/icon.png" width="96" alt="DeepSeek Harness Desktop" />
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>The DeepSeek Harness web experience as a native Windows app — double-click, no Node, no CLI.</strong><br />
  Shares the same sessions and credentials as the official Web/CLI, and ships a root-cause fix for an upstream session-log corruption bug.
</p>

<p align="center">
  <a href="https://github.com/YHDYYDS/deepseek-harness-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/YHDYYDS/deepseek-harness-desktop?include_prereleases&style=flat-square&color=4d6bfe" /></a>
  <a href="https://github.com/YHDYYDS/deepseek-harness-desktop/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/YHDYYDS/deepseek-harness-desktop?style=flat-square&color=4d6bfe" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/Windows-10%2F11%20x64-4d6bfe?style=flat-square" />
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-4d6bfe?style=flat-square" /></a>
</p>

> **In one line:** the complete DeepSeek Harness web experience (model routing, tools, sandbox, sessions, four agent presets) as a native Windows app — not a browser wrapper. The entire agent host runs **natively inside the Electron main process**.

[中文说明](README.zh.md)

## Why this shell, not the others

| Dimension | This project | Typical community shells |
|---|---|---|
| Host carrier | **Native in-process embed** (`runProfile` boots the Cordis context in Electron main) | spawn `dsh web` as a child process + parse stdout for the port |
| Process model | Single process tree, no second Node/V8 | Electron (shell) + dsh (child) dual runtimes |
| Prerequisites | Zero: target machine needs no Node/pnpm/dsh | some need system Node, others bundle a node.exe |
| Crash recovery | Health check + exception driven, **bounded in-process host rebuild** | mostly kill-and-done |
| Quality gate | **Packaged-app smoke test in CI** (proves `__DSH_BOOT__` injection) | rare |
| Upstream contribution | **Root-cause fix for upstream session-log corruption** (with regression test, PR branch ready) | none |
| Size | ~139MB installer, ~700MB installed (asar off, real-file layout) | varies |

**The kernel-level difference:** most shells manage harness as a black-box child process; building this one surfaced a real upstream data-corruption bug (two hosts cold-booting together double-repair the same interrupted session → duplicate seq events → "seq gap in committed region"), and the [root-cause fix with a regression test](https://github.com/YHDYYDS/deepseek-harness-desktop/commit/9540305481) went back into the harness codebase, with a [PR branch ready](https://github.com/YHDYYDS/deepseek-harness/tree/fix/session-repair-seq-race) for when upstream opens pull requests. Shells are easy; fixing the kernel is what sets this apart.

## ✨ Features

- 🚀 **Double-click and go**: bundled Electron runtime (Node 22) and the full harness plugin set — no environment setup
- 🪟 **Boot loading page**: branded splash with live status instead of a silent wait
- 🛡️ **Crash self-recovery**: health-checked host rebuild, bounded (3 per 10 min) with a loud error box — never a silent zombie
- 🔗 **Fully interoperable with the official builds**: shares `~/.dsh` sessions, settings, API keys and the four agent presets (standard / PTC / minimal / creator)
- 🔒 **Local-only security**: host binds `127.0.0.1` on an OS-assigned port; renderer fully sandboxed, no off-origin navigation or popups
- 🐋 **Single instance + graceful shutdown**: relaunch focuses the existing window; close disposes the host and releases the port
- ✅ **CI smoke gate**: every release build runs the packaged binary headless against a throwaway data dir

## 📦 Download (Windows 10/11 x64)

| Build | Notes | Link |
|---|---|---|
| **Installer (recommended)** | NSIS wizard; installs once, opens in seconds | [Latest release](https://github.com/YHDYYDS/deepseek-harness-desktop/releases/latest) |
| **Portable** | No install; self-extracts ~660MB on every launch (slower first start) | Same release page, `-portable.exe` |

All versions live on the [Releases page](https://github.com/YHDYYDS/deepseek-harness-desktop/releases). On first launch, configure **your own DeepSeek API key** (stored only in your local `~/.dsh`, never shipped with the app).

## 🖥️ Usage

1. Install and launch from the Start menu.
2. Loading page → the full Harness UI.
3. Existing CLI/Web users inherit everything — same sessions, settings and presets.
4. Closing the window exits cleanly (host disposed, port released).

## 🔧 Developers

```bash
pnpm install && pnpm run build                # packages lib + apps/web dist

pnpm --filter @deepseek-ai/dsh-desktop run start           # dev run
pnpm --filter @deepseek-ai/dsh-desktop run dist            # nsis + portable
pnpm --filter @deepseek-ai/dsh-desktop run smoke:packaged  # packaged smoke test
```

Push a `v*` tag to trigger `.github/workflows/desktop-release.yml`: build → **smoke test** → attach to release.

Packaging uses `asar: false` (VS Code-style layout): the harness relies on real filesystem paths (profile symlinks, worker scripts, koffi FFI, ESM entry), which asar systematically breaks. The entry is a CJS bootstrap that installs the `@deepseek-ai/*` ESM resolve fallback Electron lacks.

Full design notes: [apps/desktop/README.md](apps/desktop/README.md) and [apps/desktop/DESIGN.md](apps/desktop/DESIGN.md).

## 🔒 Security model

- Host binds `127.0.0.1` + OS-assigned port only; no `--host 0.0.0.0`, no `--trusted-host`.
- Renderer fully sandboxed (`contextIsolation` + `sandbox`, no Node, no preload); popups and off-origin navigation denied.
- Loading page CSP locked to zero external resources.
- Same as `dsh web`: the loopback API is unauthenticated (any local process can call it) — the desktop form adds no attack surface and changes none.
- Smoke tests run against a throwaway `DSH_HOME`, never real session data.

## ⚠️ Known limitations

- **Unsigned build**: SmartScreen shows "unknown publisher" → More info → Run anyway.
- **Windows x64 only**; macOS/Linux not built.
- **No auto-update**: grab new versions from Releases and reinstall.
- Portable self-extracts ~660MB per launch; daily use prefers the installer.
- ~700MB installed (`asar: false` is the price of a stable real-file layout).

## 📜 License & disclaimer

An **unofficial community build** of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), not affiliated with or endorsed by DeepSeek; the name and whale logo are DeepSeek trademarks used for identification only. Based on the MIT-licensed harness codebase (including the upstream session-persistence fix); the added desktop code is MIT too. The installer bundles third-party CLI binaries (Codex, Claude Code, etc. as subagent providers) — review their terms before public redistribution.

---

*非官方 Windows 桌面版 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：完整 Web 组合原生内嵌 Electron 主进程（非子进程套壳），零依赖、与 CLI/Web 共享数据、崩溃自愈、CI 打包冒烟门禁，并包含上游会话日志损坏 bug 的根治修复。*
