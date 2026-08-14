/**
 * In-app auto-update via electron-updater against GitHub Releases.
 *
 * Only the installed NSIS build can self-update: the portable target cannot
 * replace its own running exe (routed to the releases page instead), and
 * development/smoke runs are inert. The updater is strictly best-effort —
 * every failure degrades to a dialog plus a releases link, never to a broken
 * app. A background check runs shortly after boot; downloaded updates prompt
 * once, and also install silently on quit if the user defers.
 *
 * IMPORTANT release discipline: the git tag must be `v<version>` where
 * `<version>` equals the `version` field in apps/desktop/package.json, since
 * the channel file (latest.yml) carries that version and the updater compares
 * it against app.getVersion().
 *
 * NOTE: `autoUpdater` is exported by electron-updater through a getter
 * (Object.defineProperty), which Node's CJS named-export detection cannot
 * see — hence the default-import + property access pattern below. A named
 * ESM import would throw at runtime.
 * @module @deepseek-ai/dsh-desktop/updater
 */

import { app, dialog, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { ProgressInfo, UpdateCheckResult, UpdateInfo } from 'electron-updater'

const FEED_OWNER = 'YHDYYDS'
const FEED_REPO = 'deepseek-harness-desktop'
const RELEASES_URL = `https://github.com/${FEED_OWNER}/${FEED_REPO}/releases`
/** First background check a little after boot so it never competes with host startup. */
const STARTUP_CHECK_DELAY_MS = 25_000
/** Log download progress at most every N percent. */
const PROGRESS_LOG_STEP_PCT = 10

/** Boot-log logger injected from main. */
type Trace = (line: string) => void

/** Outcome of the in-flight interactive check, recorded by events. */
type InteractiveOutcome = 'none' | 'not-available' | 'available' | 'downloaded' | 'failed'

let trace: Trace = () => {}
let busy = false
let interactive = false
let interactiveOutcome: InteractiveOutcome = 'none'
let interactiveVersion = ''
let interactiveError = ''
let lastLoggedPct = -1

function isSmokeRun(): boolean {
  return process.env.DSH_DESKTOP_SMOKE === '1'
}

/** electron-builder sets this env var while the portable build runs. */
function isPortableBuild(): boolean {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  return typeof dir === 'string' && dir.length > 0
}

/** True when this build can replace itself: the installed (NSIS) app. */
export function isUpdaterEnabled(): boolean {
  return app.isPackaged && process.platform === 'win32' && !isSmokeRun() && !isPortableBuild()
}

function logUpdater(line: string): void {
  trace(`updater: ${line}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.message || error.name) : String(error)
}

/** Portable / dev builds cannot self-replace: point at the downloads page. */
async function offerManualDownload(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: isPortableBuild() ? '便携版不支持应用内自更新' : '开发模式不支持应用内更新',
    detail: '当前版本运行时无法替换自身。可以打开 Releases 页面手动下载最新安装包。',
    buttons: ['打开 Releases 页', '关闭'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) void shell.openExternal(RELEASES_URL)
}

async function showUpToDate(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: '已是最新版本',
    detail: `当前版本：${app.getVersion()}`,
    buttons: ['确定', '查看 Releases'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response === 1) void shell.openExternal(RELEASES_URL)
}

async function showDownloadStarted(version: string): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: `发现新版本 ${version}`,
    detail: '正在后台下载，完成后会提示重启安装。',
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0,
  })
}

async function showNoChannel(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: '暂时没有可用的更新源',
    detail: 'Releases 中还没有包含自动更新元数据的版本，或网络无法访问 GitHub。',
    buttons: ['打开 Releases 页', '关闭'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) void shell.openExternal(RELEASES_URL)
}

async function showCheckFailed(message: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: '检查更新失败',
    message: '无法检查更新',
    detail: `${message}\n\n如果网络无法访问 GitHub，可打开 Releases 页面手动下载。`,
    buttons: ['打开 Releases 页', '关闭'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) void shell.openExternal(RELEASES_URL)
}

/** Downloaded and ready: prompt once; on confirmation quit and install. */
async function promptInstall(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `DeepSeek Harness ${version} 已下载完成`,
    detail: '点击「立即重启」退出应用并静默安装更新。安装时 Windows 可能弹出用户账户控制（UAC）确认。',
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    logUpdater(`installing ${version} (quitAndInstall)`)
    electronUpdater.autoUpdater.quitAndInstall(true, true)
  } else {
    logUpdater(`install deferred by user (${version}) — will install on quit`)
  }
}

/**
 * Wire the updater to GitHub Releases and schedule the background startup
 * check. No-op unless {@link isUpdaterEnabled}. Interactive dialogs are all
 * driven from {@link checkForUpdatesInteractive}; background checks only log
 * until an update is fully downloaded (then prompt).
 * @param bootLog - boot-log logger from main (same sink as trace()).
 */
export function initUpdater(bootLog: Trace): void {
  trace = bootLog
  if (!isUpdaterEnabled()) {
    logUpdater(
      `disabled (packaged=${String(app.isPackaged)}, portable=${String(isPortableBuild())}, smoke=${String(isSmokeRun())})`,
    )
    return
  }

  const autoUpdater = electronUpdater.autoUpdater
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: FEED_OWNER, repo: FEED_REPO })
  } catch (error) {
    logUpdater(`setFeedURL failed — ${errorMessage(error)}`)
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = true
  autoUpdater.logger = { info: logUpdater, warn: logUpdater, error: logUpdater, debug: logUpdater }

  autoUpdater.on('checking-for-update', () => logUpdater('checking for updates'))
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    lastLoggedPct = -1
    logUpdater(`update available: ${info.version} — downloading in background`)
    if (interactive) {
      interactiveOutcome = 'available'
      interactiveVersion = info.version
    }
  })
  autoUpdater.on('update-not-available', () => {
    logUpdater('up to date')
    if (interactive) interactiveOutcome = 'not-available'
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const pct = Math.floor(progress.percent)
    if (pct >= lastLoggedPct + PROGRESS_LOG_STEP_PCT) {
      lastLoggedPct = pct
      logUpdater(`downloading ${String(pct)}%`)
    }
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logUpdater(`update downloaded: ${info.version}`)
    if (interactive) interactiveOutcome = 'downloaded'
    // Prompt in every mode: background checks also deserve the install offer.
    void promptInstall(info.version)
  })
  autoUpdater.on('error', (error: Error) => {
    logUpdater(`error — ${errorMessage(error)}`)
    if (interactive) {
      interactiveOutcome = 'failed'
      interactiveError = errorMessage(error)
    }
  })

  setTimeout(() => {
    if (!busy && isUpdaterEnabled()) {
      busy = true
      logUpdater('background check on startup')
      void autoUpdater.checkForUpdates().catch((error: unknown) => {
        logUpdater(`background check failed — ${errorMessage(error)}`)
      }).finally(() => {
        busy = false
      })
    }
  }, STARTUP_CHECK_DELAY_MS)

  logUpdater(`enabled (feed: github.com/${FEED_OWNER}/${FEED_REPO})`)
}

/**
 * Manual "check for updates" (menu item). Safe to call repeatedly: concurrent
 * checks are ignored. Events record the outcome while the check promise is in
 * flight; this function turns that outcome into exactly one dialog.
 */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!isUpdaterEnabled()) {
    await offerManualDownload()
    return
  }
  if (busy) {
    logUpdater('check already in progress — ignoring')
    await dialog.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '正在后台检查更新',
      detail: '请稍候，更新下载完成后会弹出安装提示。',
      buttons: ['知道了'],
      defaultId: 0,
      cancelId: 0,
    })
    return
  }

  busy = true
  interactive = true
  interactiveOutcome = 'none'
  interactiveVersion = ''
  interactiveError = ''
  let result: UpdateCheckResult | null = null
  try {
    result = await electronUpdater.autoUpdater.checkForUpdates()
  } catch (error) {
    logUpdater(`check threw — ${errorMessage(error)}`)
  }

  if (interactive) {
    interactive = false
    // Copy through an assertion: TS narrows the module-level variable to
    // 'none' here because the mutating event callbacks run inside the
    // awaited promise, and annotated consts keep that narrowed type.
    const outcome = interactiveOutcome as InteractiveOutcome
    switch (outcome) {
      case 'not-available':
        await showUpToDate()
        break
      case 'available':
        await showDownloadStarted(interactiveVersion)
        break
      case 'downloaded':
        // promptInstall already offered the restart.
        break
      case 'failed':
        await showCheckFailed(interactiveError)
        break
      default:
        if (result === null) {
          await showNoChannel()
        } else if (result.isUpdateAvailable) {
          // The check promise can be shared with an in-flight background
          // check that already found an update: reflect that instead of
          // claiming the app is current.
          await showDownloadStarted(result.updateInfo.version)
        } else {
          await showUpToDate()
        }
    }
  }
  busy = false
}
