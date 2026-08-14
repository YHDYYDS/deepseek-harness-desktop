/**
 * Application lifecycle: graceful host disposal before the process quits.
 * The bounded shutdown controller from dsh (`shutdown.shutdown`) disposes the
 * whole boot tree (webserver close, watchers, fibers) and force-exits after a
 * 5s grace budget as its own escape hatch.
 * @module @deepseek-ai/dsh-desktop/lifecycle
 */

import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { HostHandle } from './host.js'

/**
 * Wire Electron quit semantics to the embedded host.
 * `before-quit` is intercepted once: dispose the tree, then quit for real.
 * @param host - the booted host handle.
 * @param getWindow - accessor for the main window (may return null).
 */
export function installLifecycle(host: HostHandle, getWindow: () => BrowserWindow | null): void {
  let disposed = false
  let quitting = false

  app.on('before-quit', (event) => {
    if (disposed) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    void (async () => {
      try {
        await host.shutdown.shutdown(0)
      } finally {
        disposed = true
        app.quit()
      }
    })()
  })

  // Windows convention: the last window closing ends the app.
  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('second-instance', () => {
    const win = getWindow()
    if (win === null) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}
