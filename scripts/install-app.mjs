#!/usr/bin/env node
/**
 * `npm run app:install`: puts a *linked* build of the app in /Applications.
 *
 * The bundle holds Electron and a few-line entry that runs this checkout's build (`out/main/index.js`), so it sits
 * in the Dock and Launchpad and survives restarts like any app, while an update is only `npm run build` (or a
 * running `npm run build:watch`): the window reloads on a new renderer bundle and offers a restart on a new main
 * build (src/main/rebuilds.ts). Moving or deleting the checkout breaks it; run this again after a version bump.
 *
 * The release build (`npm run dist`, electron-builder.yml) is the standalone app to hand to someone; this one is
 * for the developer's own Mac. Signed ad hoc, built locally, so Gatekeeper does not ask.
 *
 * Prerequisite: `electron-vite build` (the npm script runs it first).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('the linked app is built on a Mac')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const productName = pkg.productName
const appId = /^appId:\s*(\S+)\s*$/m.exec(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))?.[1]
if (!appId) throw new Error('appId not found in electron-builder.yml')
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version

const main = join(root, 'out/main/index.js')
if (!existsSync(main)) throw new Error(`${main} is missing; run \`npm run build\` first`)

const work = join(root, 'release/linked')
const stage = join(work, 'app')
const output = join(work, 'dist')
rmSync(work, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

// The entry: TR_SOURCE_ROOT tells main it runs a checkout from a packaged shell (src/main/source-checkout.ts).
const entry = `// ${productName} linked to the checkout at ${root}: it runs that checkout's build (out/), so
// \`npm run build\` there is all an update takes (scripts/install-app.mjs).
const { existsSync } = require('node:fs')
const { app, dialog } = require('electron')

const root = ${JSON.stringify(root)}
const main = ${JSON.stringify(main)}
process.env.TR_SOURCE_ROOT = root
if (existsSync(main)) {
  require(main)
} else {
  void app.whenReady().then(() => {
    dialog.showErrorBox(${JSON.stringify(`${productName} 找不到要运行的构建`)}, \`\${main} 不存在。请在 \${root} 运行 npm run build，或重新运行 npm run app:install。\`)
    app.quit()
  })
}
`
writeFileSync(join(stage, 'main.cjs'), entry)
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify({ name: pkg.name, productName, version: pkg.version, description: pkg.description, author: pkg.author, main: 'main.cjs' }, null, 2)}\n`
)

// A config of its own (not merged with electron-builder.yml): no node-pty to unpack, no afterPack, no asar, and none
// of the checkout's node_modules (the entry loads them from the checkout).
const config = {
  appId,
  productName,
  electronVersion,
  directories: { app: stage, output, buildResources: join(root, 'build') },
  files: ['main.cjs', 'package.json', '!node_modules/**'],
  asar: false,
  npmRebuild: false,
  publish: null,
  mac: {
    icon: join(root, 'build/icon.icns'),
    category: 'public.app-category.developer-tools',
    electronLanguages: ['en', 'zh_CN', 'zh_TW'],
    identity: '-',
    // node-pty's .node is loaded from the checkout, signed apart from this bundle: library validation would refuse it.
    hardenedRuntime: false,
    // Never sent to Apple, even when the APPLE_API_* env vars of a release build are around.
    notarize: false,
    target: [{ target: 'dir', arch: [process.arch] }]
  }
}
const configFile = join(work, 'electron-builder.json')
writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)

execFileSync(join(root, 'node_modules/.bin/electron-builder'), ['--mac', 'dir', `--${process.arch}`, '--config', configFile, '--projectDir', root, '--publish', 'never'], {
  cwd: root,
  stdio: 'inherit'
})

const built = join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${productName}.app`)
if (!existsSync(built)) throw new Error(`electron-builder did not produce ${built}`)
const target = `/Applications/${productName}.app`
rmSync(target, { recursive: true, force: true })
execFileSync('ditto', [built, target]) // keeps the frameworks' symlinks and signatures
console.log(`\ninstalled ${target} (runs ${root})`)
console.log('A copy that is running keeps the old shell until it is restarted; `npm run build` updates it from now on.')
