/**
 * Host bootstrap for the desktop shell: boot the shipped `web` composition
 * inside the Electron main process with an OS-assigned loopback port, then
 * report the canonical URL for the BrowserWindow.
 *
 * Route C / C2 carrier — see DESIGN.md. The whole harness (sessions, tools,
 * sandbox, model route, frontend static, __DSH_BOOT__ injection) runs here;
 * nothing is spawned as a child process.
 * @module @deepseek-ai/dsh-desktop/host
 */

import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'

type BootResult = Awaited<ReturnType<typeof runProfile>>

/** The booted host plus the URL the window must load. */
export interface HostHandle {
  readonly ctx: BootResult['ctx']
  readonly shutdown: BootResult['shutdown']
  readonly url: string
}

/** Structural view of the mounted dsh-host-webserver service. */
interface WebServerLike {
  readonly port: number
}

/**
 * Boot the web profile inside this process and resolve its listening URL.
 * The invocation names `--port 0` so the OS assigns a free loopback port;
 * `--host` stays unset, keeping the deployment default of 127.0.0.1.
 * @returns the live host handle; rejects when boot or port resolution fails.
 */
export async function startHost(): Promise<HostHandle> {
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [],
    args: ['--port', '0'],
  })
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (webServer === undefined || typeof webServer.port !== 'number') {
    throw new Error('dsh-desktop: the web composition mounted no webServer service')
  }
  return { ctx, shutdown, url: `http://127.0.0.1:${String(webServer.port)}` }
}
