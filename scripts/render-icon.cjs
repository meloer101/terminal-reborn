// Renders build/icon.svg to a transparent 1024 px PNG using Electron's own Chromium.
// Usage: electron scripts/render-icon.cjs <input.svg> <output.png>   (called by scripts/make-icon.sh)
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')

const [input, output] = process.argv.slice(-2)

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const svg = readFileSync(input, 'utf8')
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(output, image.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
