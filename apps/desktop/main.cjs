/**
 * CJS bootstrap for the packaged desktop app.
 *
 * The ESM main (lib/main.js) is shipped unpacked (app.asar.unpacked) because
 * Electron cannot load an ESM entry from inside app.asar. From the unpacked
 * location, bare `@deepseek-ai/*` imports cannot walk up into
 * app.asar/node_modules — so the resolve hook below redirects them through the
 * DSH profile fallback (`$DSH_HOME/profiles/node_modules`, the same anchor the
 * CLI's internal ESM loader uses). The hook MUST be installed before the ESM
 * main and its static imports load, which is why this CJS shim exists at all.
 * @module @deepseek-ai/dsh-desktop/bootstrap
 */

const { homedir } = require('node:os')
const { join } = require('node:path')
const { createRequire, registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const dshHome = (process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
const profileAnchor = join(dshHome, 'profiles', 'web', 'package.json')
const installRequire = createRequire(profileAnchor)

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('@deepseek-ai/')) throw error
      try {
        return { url: pathToFileURL(installRequire.resolve(specifier)).href, shortCircuit: true }
      } catch {
        throw error
      }
    }
  },
})

import('./lib/main.js').catch((error) => {
  const { app, dialog } = require('electron')
  const detail = error && error.stack ? error.stack : String(error)
  try {
    dialog.showErrorBox('DeepSeek Harness Desktop failed to start', detail)
  } catch {
    /* the dialog may be unavailable this early — the exit code still reports */
  }
  app.exit(1)
})
