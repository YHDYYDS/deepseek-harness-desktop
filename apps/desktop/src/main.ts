/**
 * dsh-desktop — Electron main entry.
 * Single instance → loading page → embedded host → one sandboxed window.
 *
 * Resilience: the embedded host is supervised in-process. A loopback health
 * check and the process-level uncaught-exception path both trigger a bounded
 * restart (fresh Cordis context, window back to the loading page, then back
 * to the host). After RESTART_LIMIT restarts inside RESTART_WINDOW_MS the
 * shell gives up and exits loudly instead of silently limping.
 *
 * Smoke mode: with DSH_DESKTOP_SMOKE=1 the app boots headless, probes the
 * renderer for the injected __DSH_BOOT__ client catalog, prints SMOKE_OK /
 * SMOKE_FAIL to the boot log and exits — this is what
 * scripts/smoke-packaged.mjs drives against the packaged exe.
 * @module @deepseek-ai/dsh-desktop
 */

import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { startHost, type HostHandle } from './host.js'
import { createWindow, navigateToHost, navigateToLoading, setLoadingStatus } from './window.js'
import { installLifecycle } from './lifecycle.js'

const BOOT_LOG = process.env.DSH_DESKTOP_BOOT_LOG?.trim() || join(tmpdir(), 'dsh-desktop-boot.log')

const HEALTH_INTERVAL_MS = 20_000
const HEALTH_FAILURE_THRESHOLD = 2
const HEALTH_TIMEOUT_MS = 5_000
const RESTART_LIMIT = 3
const RESTART_WINDOW_MS = 10 * 60_000
const SMOKE_TIMEOUT_MS = 90_000

/** Append one diagnostic line to the boot log (also mirrored to stdout). */
function trace(line: string): void {
  try {
    appendFileSync(BOOT_LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* diagnostics must never break boot */
  }
  console.log(`[dsh-desktop] ${line}`)
}

/** The harness engines contract: `^22.19.0 || >=24.0.0`. */
function bundledNodeSatisfiesEngines(): boolean {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (Number.isNaN(major) || Number.isNaN(minor)) return false
  return (major === 22 && minor >= 19) || major >= 24
}

function isSmokeRun(): boolean {
  return process.env.DSH_DESKTOP_SMOKE === '1'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let win: BrowserWindow | null = null
let host: HostHandle | null = null
let healthTimer: ReturnType<typeof setInterval> | undefined
let healthFailures = 0
let restarting = false
let restartCount = 0
let restartWindowStart = 0

/** Report a fatal failure: loading page error state, dialog, loud exit. */
function fatal(detail: string): void {
  trace(`fatal: ${detail}`)
  if (win !== null && !win.isDestroyed()) {
    setLoadingStatus(win, `启动失败：${detail}`, true)
  }
  if (!isSmokeRun()) {
    try {
      dialog.showErrorBox('DeepSeek Harness Desktop failed to start', detail)
    } catch {
      /* dialog may be unavailable — the boot log still reports */
    }
  }
  app.exit(1)
}

/** Stop polling the host URL (used before dispose / exit). */
function stopHealthChecks(): void {
  if (healthTimer !== undefined) {
    clearInterval(healthTimer)
    healthTimer = undefined
  }
  healthFailures = 0
}

/** Poll the loopback host; N consecutive failures trigger recovery. */
function startHealthChecks(): void {
  stopHealthChecks()
  healthTimer = setInterval(() => {
    if (host === null || restarting) return
    void (async () => {
      try {
        await fetch(`${host?.url}/`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
        healthFailures = 0
      } catch {
        healthFailures += 1
        trace(`health: ${host?.url} unreachable (${String(healthFailures)}/${String(HEALTH_FAILURE_THRESHOLD)})`)
        if (healthFailures >= HEALTH_FAILURE_THRESHOLD) void recover('loopback health check failed')
      }
    })()
  }, HEALTH_INTERVAL_MS)
}

/** Dispose the current host handle, tolerating an already-dead tree. */
async function disposeHost(handle: HostHandle): Promise<void> {
  await Promise.race([
    handle.shutdown.shutdown(0).catch((error: unknown) => {
      trace(`recover: shutdown threw — ${error instanceof Error ? error.message : String(error)}`)
    }),
    delay(6_000),
  ])
}

/**
 * Rebuild the embedded host after a crash and hand the window back to it.
 * Bounded: at most RESTART_LIMIT restarts per RESTART_WINDOW_MS, then fatal.
 */
async function recover(reason: string): Promise<void> {
  if (restarting || host === null) return
  restarting = true
  try {
    const now = Date.now()
    if (now - restartWindowStart > RESTART_WINDOW_MS) {
      restartWindowStart = now
      restartCount = 0
    }
    restartCount += 1
    if (restartCount > RESTART_LIMIT) {
      fatal(`host kept failing after ${String(RESTART_LIMIT)} restarts (last: ${reason})`)
      return
    }
    trace(`recover: ${reason} — rebuilding host (attempt ${String(restartCount)}/${String(RESTART_LIMIT)})`)

    stopHealthChecks()
    const stale = host
    host = null
    await disposeHost(stale)

    if (win !== null && !win.isDestroyed()) {
      await navigateToLoading(win)
      setLoadingStatus(win, `连接中断，正在自动恢复（第 ${String(restartCount)} 次）…`)
    }

    const fresh = await startHost()
    host = fresh
    trace(`recover: host rebuilt at ${fresh.url}`)
    if (win !== null && !win.isDestroyed()) {
      await navigateToHost(win, fresh.url)
      setLoadingStatus(win, '')
    }
    startHealthChecks()
  } catch (error) {
    fatal(`recovery failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  } finally {
    restarting = false
  }
}

/** Renderer probe for the packaged smoke test: verify the real client booted. */
async function runSmokeProbeIfRequested(): Promise<void> {
  if (!isSmokeRun() || win === null) return
  const timer = setTimeout(() => {
    trace('SMOKE_FAIL probe timeout')
    app.exit(1)
  }, SMOKE_TIMEOUT_MS)
  try {
    // The boot manifest is injected by a script in the served page; probe a few
    // times so a slow first paint on CI runners cannot fake a failure.
    for (let attempt = 1; ; attempt += 1) {
      const raw = await win.webContents.executeJavaScript(
        'JSON.stringify({ boot: !!window.__DSH_BOOT__, plugins: window.__DSH_BOOT__ ? Object.keys(window.__DSH_BOOT__).length : 0 })',
      )
      const parsed: { boot: boolean; plugins: number } = JSON.parse(String(raw))
      if (parsed.boot && parsed.plugins > 0) {
        trace(`SMOKE_OK plugins=${String(parsed.plugins)}`)
        app.exit(0)
        return
      }
      if (attempt >= 10) {
        trace(`SMOKE_FAIL boot=${String(parsed.boot)} plugins=${String(parsed.plugins)} after ${String(attempt)} attempts`)
        app.exit(1)
        return
      }
      await delay(1_000)
    }
  } catch (error) {
    trace(`SMOKE_FAIL ${error instanceof Error ? error.message : String(error)}`)
    app.exit(1)
  } finally {
    clearTimeout(timer)
  }
}

async function boot(): Promise<void> {
  trace(`boot: electron ${process.versions.electron}, node ${process.versions.node}, chrome ${process.versions.chrome}`)
  if (!bundledNodeSatisfiesEngines()) {
    fatal(`This build bundles Node ${process.versions.node}, which does not satisfy the harness engines contract (^22.19.0 || >=24.0.0).`)
    return
  }

  trace('boot: showing loading page')
  win = createWindow()
  win.on('closed', () => {
    win = null
  })
  setLoadingStatus(win, '正在准备运行时…')

  trace('boot: starting embedded host (web profile, --port 0)')
  const started = await startHost()
  host = started
  trace(`boot: host ready at ${started.url}`)

  await navigateToHost(win, started.url)
  installLifecycle(() => host, () => win)
  startHealthChecks()
  trace(`boot: serving ${started.url}`)

  await runSmokeProbeIfRequested()
}

if (!app.requestSingleInstanceLock()) {
  trace('boot: single-instance lock held elsewhere — quitting')
  app.quit()
} else {
  trace('boot: single-instance lock acquired')

  // A crash inside a harness fiber that escapes everything: recover once the
  // process is still in a state to do so, and never exit silently.
  process.on('uncaughtException', (error) => {
    trace(`uncaughtException: ${error.stack ?? error.message}`)
    if (host === null) {
      fatal(`uncaught exception during startup: ${error.stack ?? error.message}`)
      return
    }
    void recover('uncaught exception')
  })
  process.on('unhandledRejection', (reason) => {
    trace(`unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  })

  app.whenReady().then(() => {
    trace('boot: app ready')
    void boot().catch((error: unknown) => {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      trace(`boot: FAILED — ${detail}`)
      // The loader folds per-entry failures into AggregateErrors that boot()
      // buries under Error.cause; walk the chain so the real failure surfaces.
      for (let cursor: unknown = error; cursor instanceof Error && cursor.cause !== undefined; cursor = cursor.cause) {
        if (cursor.cause instanceof AggregateError) {
          cursor.cause.errors.forEach((inner, index) => {
            trace(`  inner[${index}]: ${inner instanceof Error ? (inner.stack ?? inner.message) : String(inner)}`)
          })
        }
      }
      fatal(detail)
    })
  })
}
