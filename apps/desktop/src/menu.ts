/**
 * Application menu for the desktop shell. The window is a single sandboxed
 * renderer around the DSH Web GUI, so the menu stays minimal: quit, edit and
 * view roles plus the in-app update entry point. The menu bar is hidden
 * (autoHideMenuBar) — Alt reveals it and accelerators keep working.
 * @module @deepseek-ai/dsh-desktop/menu
 */

import { app, dialog, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

const REPO_URL = 'https://github.com/YHDYYDS/deepseek-harness-desktop'
const RELEASES_URL = `${REPO_URL}/releases`

/**
 * Install the application menu.
 * @param checkForUpdates - the updater entry point (menu item 帮助 → 检查更新).
 */
export function installApplicationMenu(checkForUpdates: () => void): void {
  const template: MenuItemConstructorOptions[] = [
    { label: '文件', submenu: [{ role: 'quit', label: '退出' }] },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: () => checkForUpdates() },
        { label: '打开 Releases 页', click: () => void shell.openExternal(RELEASES_URL) },
        { type: 'separator' },
        { label: '关于 DeepSeek Harness', click: () => void showAbout() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function showAbout(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '关于',
    message: 'DeepSeek Harness Desktop',
    detail: [
      `版本 ${app.getVersion()}`,
      '',
      '把 DeepSeek Harness Web GUI 原生内嵌进 Electron 主进程的 Windows 桌面壳。',
      '',
      REPO_URL,
    ].join('\n'),
    buttons: ['确定'],
    defaultId: 0,
    cancelId: 0,
  })
}
