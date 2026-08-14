/**
 * BrowserWindow factory: a fully sandboxed renderer that first shows a local
 * loading page, then takes over the embedded host's loopback URL once it is
 * ready. Navigation away from the host origin is denied; new windows too.
 * @module @deepseek-ai/dsh-desktop/window
 */

import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const LOADING_PAGE = join(app.getAppPath(), 'loading.html')

/** True while the packaged-app smoke test runs (window stays hidden). */
function isSmokeRun(): boolean {
  return process.env.DSH_DESKTOP_SMOKE === '1'
}

/** The host origin the renderer is currently pinned to (set after takeover). */
let pinnedOrigin: string | null = null

/**
 * Create the main window showing the local loading page.
 * The host URL is loaded later via {@link navigateToHost}; the loading page
 * gives slow cold boots something visible instead of an empty desktop.
 * @returns the window, shown once its first paint is ready.
 */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'DeepSeek Harness',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // The desktop shell owns this window: no popups, no page-initiated
  // navigation off the pinned origin. Programmatic loadURL calls (loading
  // page, host takeover) do not emit `will-navigate` and are unaffected.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (pinnedOrigin === null || !url.startsWith(pinnedOrigin)) event.preventDefault()
  })

  win.once('ready-to-show', () => {
    if (!isSmokeRun()) win.show()
  })
  void win.loadFile(LOADING_PAGE)
  return win
}

/** Update the loading page status line (no-op once the host page is loaded). */
export function setLoadingStatus(win: BrowserWindow, text: string, isError = false): void {
  void win.webContents.executeJavaScript(
    `window.setBootStatus && window.setBootStatus(${JSON.stringify(text)}, ${isError ? 'true' : 'false'})`,
  ).catch(() => {
    /* the page may already have navigated away — status updates are advisory */
  })
}

/**
 * Take the window over to the booted host. Returns once the load is finished
 * so callers (smoke test) can safely probe the renderer afterwards.
 * @param win - the main window currently showing the loading page.
 * @param hostUrl - the canonical `http://127.0.0.1:<port>` URL from the host.
 */
export async function navigateToHost(win: BrowserWindow, hostUrl: string): Promise<void> {
  pinnedOrigin = new URL(hostUrl).origin
  await win.loadURL(hostUrl)
}

/** Return the window to the loading page (used during host restart). */
export async function navigateToLoading(win: BrowserWindow): Promise<void> {
  pinnedOrigin = null
  await win.loadFile(LOADING_PAGE)
}
