/**
 * BrowserWindow factory: a fully sandboxed renderer pinned to the host URL.
 * @module @deepseek-ai/dsh-desktop/window
 */

import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

/**
 * Create the main window bound to the embedded host's loopback URL.
 * Navigation away from that origin is denied; new-window requests are denied.
 * @param hostUrl - the canonical `http://127.0.0.1:<port>` URL from the host.
 * @returns the window, shown only once its first paint is ready.
 */
export function createWindow(hostUrl: string): BrowserWindow {
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

  // The desktop shell owns this window: no popups, no navigation off-origin.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(hostUrl)) event.preventDefault()
  })

  win.once('ready-to-show', () => {
    win.show()
  })
  void win.loadURL(hostUrl)
  return win
}
