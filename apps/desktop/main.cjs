/**
 * CJS bootstrap for the packaged desktop app.
 *
 * The ESM main (lib/main.js) is shipped unpacked (app.asar.unpacked) because
 * Electron cannot load an ESM entry from inside app.asar. From the unpacked
 * location, bare `@deepseek-ai/*` imports cannot resolve through Electron's
 * default ESM loader (Electron has no Node internal loader), so the resolve
 * hook below retries them against two anchors, in order:
 *
 *   1. this package itself (main.cjs sits next to package.json in both dev
 *      and packaged layouts, and the packaged app ships its full production
 *      node_modules next to it under asar:false) — this anchor alone makes
 *      a fresh machine boot without any prior dsh install;
 *   2. the DSH profile fallback (`$DSH_HOME/profiles/node_modules`) — the
 *      flat symlink tree dsh manages, kept as a secondary anchor so a user's
 *      profile-installed packages still win where they exist.
 *
 * The hook MUST be installed before the ESM main and its static imports load,
 * which is why this CJS shim exists at all.
 *
 * In smoke mode (DSH_DESKTOP_SMOKE=1) a failed boot writes the error to
 * DSH_DESKTOP_BOOT_LOG instead of raising a blocking dialog — CI smoke runs
 * are headless and the boot log is what the smoke script consumes.
 * @module @deepseek-ai/dsh-desktop/bootstrap
 */

const { appendFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')
const { createRequire, registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const appAnchor = join(__dirname, 'package.json')
const appRequire = createRequire(appAnchor)

const dshHome = (process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
const profileAnchor = join(dshHome, 'profiles', 'web', 'package.json')
const profileRequire = createRequire(profileAnchor)

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('@deepseek-ai/')) throw error
      for (const resolve of [appRequire.resolve, profileRequire.resolve]) {
        try {
          return { url: pathToFileURL(resolve(specifier)).href, shortCircuit: true }
        } catch {
          /* try the next anchor */
        }
      }
      throw error
    }
  },
})

function bootFailure(error) {
  const detail = error && error.stack ? error.stack : String(error)
  if (process.env.DSH_DESKTOP_SMOKE === '1') {
    try {
      const log = process.env.DSH_DESKTOP_BOOT_LOG || join(require('node:os').tmpdir(), 'dsh-desktop-boot.log')
      appendFileSync(log, `${new Date().toISOString()} bootstrap: FAILED — ${detail}\n`)
    } catch {
      /* diagnostics must never break the failure path */
    }
    return
  }
  const { app, dialog } = require('electron')
  try {
    dialog.showErrorBox('DeepSeek Harness Desktop failed to start', detail)
  } catch {
    /* the dialog may be unavailable this early — the exit code still reports */
  }
  app.exit(1)
}

import('./lib/main.js').catch((error) => {
  bootFailure(error)
  const { app } = require('electron')
  app.exit(1)
})
