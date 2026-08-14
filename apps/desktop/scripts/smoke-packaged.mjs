/**
 * Packaged-app smoke test.
 *
 * Launches the packaged `win-unpacked` exe in headless smoke mode (see
 * src/main.ts), points it at a fresh temp DSH_HOME so the run cannot touch
 * real user data, then waits for `SMOKE_OK` / `SMOKE_FAIL` in its boot log.
 * SMOKE_OK is only printed after the real harness page finished loading and
 * the renderer reported a non-empty `__DSH_BOOT__` client catalog — the same
 * shape check that caught the asar packaging regression.
 *
 * Usage: node scripts/smoke-packaged.mjs [path-to-exe]
 * Build `dist/win-unpacked` first (`pnpm --filter @deepseek-ai/dsh-desktop run pack`).
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_EXE = resolve(scriptDir, '..', 'dist', 'win-unpacked', 'DeepSeek Harness.exe')
const exe = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_EXE

const TIMEOUT_MS = 180_000
const POLL_MS = 500

if (!existsSync(exe)) {
  console.error(`[smoke] exe not found: ${exe}`)
  console.error('[smoke] build the unpacked app first: pnpm --filter @deepseek-ai/dsh-desktop run pack')
  process.exit(2)
}

const runDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
const bootLog = join(runDir, 'boot.log')
const dshHome = join(runDir, '.dsh')

const env = {
  ...process.env,
  DSH_DESKTOP_SMOKE: '1',
  DSH_DESKTOP_SMOKE_USERDATA: join(runDir, 'userdata'),
  DSH_DESKTOP_BOOT_LOG: bootLog,
  DSH_HOME: dshHome,
}

console.log(`[smoke] exe:     ${exe}`)
console.log(`[smoke] DSH_HOME: ${dshHome}`)
console.log(`[smoke] bootlog: ${bootLog}`)
console.log('[smoke] launching packaged app in headless smoke mode…')

const child = spawn(exe, [], { env, stdio: 'ignore', windowsHide: true })

function killTree() {
  if (child.pid === undefined) return
  try {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    /* the tree is likely already gone */
  }
}

let settled = false
const settle = (code, message) => {
  if (settled) return
  settled = true
  killTree()
  console.log(`[smoke] ${message}`)
  console.log(`[smoke] artifacts kept at ${runDir}`)
  process.exit(code)
}

child.on('error', (error) => {
  settle(1, `FAIL: could not launch packaged app — ${error.message}`)
})

const deadline = Date.now() + TIMEOUT_MS
const poll = () => {
  if (Date.now() > deadline) {
    settle(1, 'FAIL: SMOKE_OK not observed before timeout — app never proved a healthy renderer')
    return
  }
  let log = ''
  try {
    log = readFileSync(bootLog, 'utf8')
  } catch {
    /* boot log appears on first trace */
  }
  const ok = log.match(/SMOKE_OK(?: entries=(\d+))?/)
  const fail = log.match(/SMOKE_FAIL.*/)
  if (ok !== null) {
    settle(0, `PASS: renderer reported a healthy client boot (entries=${ok[1] ?? '?'})`)
    return
  }
  if (fail !== null) {
    settle(1, `FAIL: ${fail[0].trim()}`)
    return
  }
  setTimeout(poll, POLL_MS)
}
setTimeout(poll, POLL_MS)
