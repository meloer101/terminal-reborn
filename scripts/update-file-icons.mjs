#!/usr/bin/env node
// Writes src/renderer/panels/files/file-icons.data.ts (右侧栏 · 文件's per-type icons, PRD F17, Figma 72A) from
// material-icon-theme (MIT, https://github.com/material-extensions/vscode-material-icon-theme). Only the extensions and
// file names below are kept, and every colour has its OKLab chroma scaled by CHROMA (lightness and hue unchanged), so the
// icons sit quieter than VS Code's. The file is generated: change this script and run it, never edit it by hand.
//   npm pack material-icon-theme@5.40.0 && tar xzf material-icon-theme-5.40.0.tgz
//   node scripts/update-file-icons.mjs ./package
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../src/renderer/panels/files/file-icons.data.ts', import.meta.url))
const CHROMA = 0.65

const EXT = `ts tsx mts cts d.ts js jsx mjs cjs json jsonc json5 md mdx markdown yml yaml toml swift py rs go css scss sass less html htm svg
png jpg jpeg gif webp avif ico icns heic bmp tiff sh zsh bash fish txt sql java kt kts rb c cc cpp h hpp m mm cs vue svelte astro
plist xml log env zip gz tgz tar dmg pdf mp4 mov webm mp3 wav ttf otf woff woff2 patch diff proto graphql lua php dart zig ex exs hs
csv ini cfg conf lock gradle tf nix vim ps1 r jl scala clj erl ml sol wasm glsl wgsl ipynb tex prisma sqlite db
test.ts test.tsx spec.ts spec.tsx test.js spec.js`.split(/\s+/)

const NAMES = `package.json package-lock.json tsconfig.json .gitignore .gitattributes .gitmodules dockerfile docker-compose.yml compose.yaml
license license.md license.txt readme.md changelog.md contributing.md claude.md claude.local.md agents.md gemini.md
copilot-instructions.md .cursorrules makefile go.mod go.sum .editorconfig .prettierrc .prettierignore eslint.config.mjs
eslint.config.js eslint.config.ts vite.config.ts vite.config.js vite.config.mjs playwright.config.ts vitest.config.ts .npmrc .nvmrc
podfile vercel.json .vercelignore bun.lock bun.lockb pnpm-lock.yaml pnpm-workspace.yaml yarn.lock tailwind.config.ts
tailwind.config.js astro.config.mjs astro.config.ts gemfile requirements.txt pyproject.toml uv.lock codeowners security.md
biome.json turbo.json deno.json .python-version procfile justfile cmakelists.txt pom.xml robots.txt favicon.ico
next.config.js next.config.mjs next.config.ts svelte.config.js webpack.config.js babel.config.js jest.config.js .babelrc
.npmignore .yarnrc.yml renovate.json firebase.json wrangler.toml netlify.toml .env .env.local .env.example`.split(/\s+/)

const pkg = process.argv[2]
if (!pkg) throw new Error('usage: node scripts/update-file-icons.mjs <unpacked material-icon-theme package dir>')
const { version } = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf8'))
// PRD v1.180 and THIRD_PARTY_NOTICES.md name this version; moving to another one updates them too.
const VERSION = '5.40.0'
if (version !== VERSION) throw new Error(`expected material-icon-theme ${VERSION}, got ${version}`)
const manifest = JSON.parse(await readFile(path.join(pkg, 'dist/material-icons.json'), 'utf8'))

const lowerKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
const fileNames = lowerKeys(manifest.fileNames)
const lightNames = lowerKeys(manifest.light.fileNames)

const byExt = {}
const byName = {}
const light = {}
for (const e of EXT) {
  const icon = manifest.fileExtensions[e] ?? manifest.languageIds[e]
  if (!icon) continue
  byExt[e] = icon
  if (manifest.light.fileExtensions[e]) light[icon] = manifest.light.fileExtensions[e]
}
/** The icon file-icon.ts finds by extension: longest compound first; a leading dot is part of the name. */
function extIcon(name) {
  for (let dot = name.indexOf('.', 1); dot >= 0; dot = name.indexOf('.', dot + 1)) {
    if (byExt[name.slice(dot + 1)]) return byExt[name.slice(dot + 1)]
  }
  return undefined
}
for (const n of NAMES) {
  const icon = n === '.env' ? 'tune' : fileNames[n]
  if (!icon) continue
  // A name whose icon its extension already gives is left to the extension.
  if (icon !== extIcon(n)) byName[n] = icon
  if (lightNames[n]) light[icon] = lightNames[n]
}

// OKLab (Björn Ottosson): scale chroma by k, keep perceived lightness and hue.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
function desaturate(hex, k) {
  let h = hex.slice(1)
  if (h.length === 3) h = [...h].map((x) => x + x).join('')
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * k
  const B = (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * k
  const l2 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m2 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
    -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
    -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2
  ]
  return '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, '0')).join('')
}

const used = [...new Set([...Object.values(byExt), ...Object.values(byName), ...Object.values(light)])].sort()
const svgs = {}
for (const name of used) {
  const raw = (await readFile(path.join(pkg, 'icons', `${name}.svg`), 'utf8')).trim().replace(/\s*\n\s*/g, ' ')
  svgs[name] = raw.replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, (hex) => desaturate(hex, CHROMA))
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
const record = (name, doc, o) => `/** ${doc} */\nexport const ${name}: Readonly<Record<string, string>> = ${JSON.stringify(sorted(o), null, 1)}\n`
const out =
  `// Generated by scripts/update-file-icons.mjs from material-icon-theme ${version} (MIT, Copyright (c) 2025 Material Extensions), ` +
  `chroma × ${CHROMA}. Do not edit.\n` +
  record('ICON_BY_NAME', 'Lower-case file name → icon.', byName) +
  record('ICON_BY_EXT', 'Lower-case extension without the leading dot (compound ones like test.ts too) → icon.', byExt) +
  record('LIGHT_ICON', "Icon → the light theme's variant, where material has one.", light) +
  record('ICON_SVG', 'Icon → SVG markup.', svgs)
await writeFile(OUT, out)
console.log(`ext ${Object.keys(byExt).length}, names ${Object.keys(byName).length}, light ${Object.keys(light).length}, icons ${used.length}, bytes ${out.length}`)
