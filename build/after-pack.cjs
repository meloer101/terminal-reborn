// electron-builder afterPack: runs before code signing. node-pty's prebuilt spawn-helper must be
// executable inside the bundle, otherwise every PTY fails to spawn (posix_spawn EACCES). Fixed here at
// build time so the signed bundle is never touched at runtime.
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const prebuilds = join(context.appOutDir, appName, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuilds)) throw new Error(`node-pty prebuilds missing from the bundle: ${prebuilds} (check asarUnpack)`)
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
