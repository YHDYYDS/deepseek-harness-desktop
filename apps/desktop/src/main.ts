/**
 * dsh-desktop — Electron main entry.
 * Single instance → boot the embedded host → one sandboxed window.
 * @module @deepseek-ai/dsh-desktop
 */

import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { startHost } from './host.js'
import { createWindow } from './window.js'
import { installLifecycle } from './lifecycle.js'

const BOOT_LOG = join(tmpdir(), 'dsh-desktop-boot.log')

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

let win: BrowserWindow | null = null

async function boot(): Promise<void> {
  trace(`boot: electron ${process.versions.electron}, node ${process.versions.node}, chrome ${process.versions.chrome}`)
  if (!bundledNodeSatisfiesEngines()) {
    trace(`boot: bundled node ${process.versions.node} fails engines — aborting`)
    dialog.showErrorBox(
      'DeepSeek Harness Desktop',
      `This build bundles Node ${process.versions.node}, which does not satisfy the harness engines contract (^22.19.0 || >=24.0.0).`,
    )
    app.exit(1)
    return
  }
  trace('boot: starting embedded host (web profile, --port 0)')
  const host = await startHost()
  trace(`boot: host ready at ${host.url}`)
  win = createWindow(host.url)
  win.on('closed', () => {
    win = null
  })
  installLifecycle(host, () => win)
  trace(`boot: serving ${host.url}`)
}

if (!app.requestSingleInstanceLock()) {
  trace('boot: single-instance lock held elsewhere — quitting')
  app.quit()
} else {
  trace('boot: single-instance lock acquired')
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
      dialog.showErrorBox('DeepSeek Harness Desktop failed to start', detail)
      app.exit(1)
    })
  })
}
