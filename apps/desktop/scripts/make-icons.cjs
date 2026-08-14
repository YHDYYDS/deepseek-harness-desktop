/**
 * One-off icon generator: rasterize the shipped DeepSeek favicon SVG to a
 * 256px PNG using Electron's offscreen renderer (no image deps required), then
 * wrap the PNG into a Vista+ PNG-compressed ICO for electron-builder.
 *
 * Usage: electron.exe scripts/make-icons.cjs <path-to-favicon.svg> <out-dir> [blue]
 * The optional `blue` variant renders the whale in the DeepSeek brand color
 * (#4D6BFE) instead of the favicon's scheme-dependent black/white.
 * @module @deepseek-ai/dsh-desktop/make-icons
 */

const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const [, , faviconPath, outDir, variant] = process.argv
if (!faviconPath || !outDir) {
  console.error('usage: electron scripts/make-icons.cjs <favicon.svg> <out-dir> [blue]')
  app.exit(2)
}

/** Build a Vista+ ICO container holding PNG-compressed entries per size. */
function pngToIco(entries) {
  const headerSize = 6 + 16 * entries.length
  const total = headerSize + entries.reduce((sum, entry) => sum + entry.data.length, 0)
  const buf = Buffer.alloc(total)
  buf.writeUInt16LE(0, 0) // reserved
  buf.writeUInt16LE(1, 2) // type: icon
  buf.writeUInt16LE(entries.length, 4) // count
  let offset = headerSize
  entries.forEach((entry, index) => {
    const dir = 6 + 16 * index
    buf.writeUInt8(entry.size === 256 ? 0 : entry.size, dir) // width (0 = 256)
    buf.writeUInt8(entry.size === 256 ? 0 : entry.size, dir + 1) // height
    buf.writeUInt8(0, dir + 2) // palette
    buf.writeUInt8(0, dir + 3) // reserved
    buf.writeUInt16LE(1, dir + 4) // planes
    buf.writeUInt16LE(32, dir + 6) // bpp
    buf.writeUInt32LE(entry.data.length, dir + 8) // payload size
    buf.writeUInt32LE(offset, dir + 12) // payload offset
    entry.data.copy(buf, offset)
    offset += entry.data.length
  })
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
  const svg = variant === 'blue'
    ? readFileSync(faviconPath, 'utf8').replace('</style>', '</style><style>path{fill:#4D6BFE}</style>')
    : readFileSync(faviconPath, 'utf8')
  const html = `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="200" height="200"></body></html>`
  const htmlPath = join(tmpdir(), 'dsh-icon-render.html')
  writeFileSync(htmlPath, html)
  try {
    await win.loadFile(htmlPath)
    await new Promise((resolve) => setTimeout(resolve, 400))
    // Capture is in DIP: on scaled displays the bitmap comes back larger than
    // 256. Resize to canonical sizes so each ICO entry matches its header.
    // The whale is rendered at 200/256 with transparent padding — icons that
    // touch the canvas edges look oversized when scaled to 16px.
    const captured = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })
    const entries = [16, 32, 48, 256].map((size) => ({
      size,
      data: captured.resize({ width: size, height: size }).toPNG(),
    }))
    const png = entries[3].data
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'icon.png'), png)
    writeFileSync(join(outDir, 'icon.ico'), pngToIco(entries))
    console.log(`wrote ${join(outDir, 'icon.png')} (${png.length} bytes) and icon.ico (${entries.length} sizes)`)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
