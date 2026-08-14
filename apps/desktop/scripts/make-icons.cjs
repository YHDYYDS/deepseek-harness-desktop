/**
 * One-off icon generator: rasterize the shipped DeepSeek favicon SVG to a
 * 256px PNG using Electron's offscreen renderer (no image deps required), then
 * wrap the PNG into a Vista+ PNG-compressed ICO for electron-builder.
 *
 * Usage: electron.exe scripts/make-icons.cjs <path-to-favicon.svg> <out-dir>
 * @module @deepseek-ai/dsh-desktop/make-icons
 */

const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const [, , faviconPath, outDir] = process.argv
if (!faviconPath || !outDir) {
  console.error('usage: electron scripts/make-icons.cjs <favicon.svg> <out-dir>')
  app.exit(2)
}

/** Build a Vista+ ICO container holding one PNG-compressed 256x256 entry. */
function pngToIco(png) {
  const buf = Buffer.alloc(22 + png.length)
  buf.writeUInt16LE(0, 0) // reserved
  buf.writeUInt16LE(1, 2) // type: icon
  buf.writeUInt16LE(1, 4) // count
  buf.writeUInt8(0, 6) // width 0 = 256
  buf.writeUInt8(0, 7) // height 0 = 256
  buf.writeUInt8(0, 8) // palette
  buf.writeUInt8(0, 9) // reserved
  buf.writeUInt16LE(1, 10) // planes
  buf.writeUInt16LE(32, 12) // bpp
  buf.writeUInt32LE(png.length, 14) // payload size
  buf.writeUInt32LE(22, 18) // payload offset
  png.copy(buf, 22)
  return buf
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  })
  const svg = readFileSync(faviconPath, 'utf8')
  const html = `<!doctype html><html><body style="margin:0"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="256" height="256"></body></html>`
  const htmlPath = join(tmpdir(), 'dsh-icon-render.html')
  writeFileSync(htmlPath, html)
  try {
    await win.loadFile(htmlPath)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })
    const png = image.toPNG()
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'icon.png'), png)
    writeFileSync(join(outDir, 'icon.ico'), pngToIco(png))
    console.log(`wrote ${join(outDir, 'icon.png')} (${png.length} bytes) and icon.ico`)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
