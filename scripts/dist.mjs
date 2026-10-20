#!/usr/bin/env node
/**
 * `npm run dist` / `npm run dist:dir`: electron-builder with electron-builder.yml, signed with a Developer ID when
 * there is one and ad hoc otherwise.
 *
 * - Developer ID: CSC_LINK (CI) or CSC_NAME is set, or the login keychain holds a "Developer ID Application"
 *   identity. Hardened runtime + build/entitlements.mac*.plist; notarized and stapled when the APPLE_API_* env vars
 *   are set (electron-builder does both).
 * - Otherwise: an ad-hoc signature, no notarization, and the hardened runtime off (its library validation refuses
 *   ad-hoc code: no Team ID). Runs on the Mac that built it; a download of it is blocked by Gatekeeper. An
 *   "Apple Development" certificate does not count (it cannot be notarized). CSC_IDENTITY_AUTO_DISCOVERY=false
 *   forces this.
 *
 * WAVI_REQUIRE_NOTARIZATION=1 (release.yml) refuses the fallback: no certificate or no notarization key is an error.
 *
 * Usage: node scripts/dist.mjs [--dir]   (after `electron-vite build`; the npm scripts run it first)
 */

import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('the macOS release is built on a Mac')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dirOnly = process.argv.includes('--dir')
const env = process.env

function keychainHasDeveloperId() {
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return false
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    return /"Developer ID Application: /.test(out)
  } catch {
    return false
  }
}

const developerId = Boolean(env.CSC_LINK || env.CSC_NAME) || keychainHasDeveloperId()
const notarizeKey = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)

if (env.WAVI_REQUIRE_NOTARIZATION === '1') {
  const missing = []
  if (!env.CSC_LINK) missing.push('CSC_LINK')
  if (!env.CSC_KEY_PASSWORD) missing.push('CSC_KEY_PASSWORD')
  if (!notarizeKey) missing.push('APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER')
  if (missing.length > 0) {
    console.error(`WAVI_REQUIRE_NOTARIZATION=1 but ${missing.join(', ')} not set; refusing an unsigned release`)
    process.exit(1)
  }
}

const args = ['--mac', ...(dirOnly ? ['--dir'] : []), '--publish', 'never']
if (env.WAVI_REQUIRE_NOTARIZATION === '1') args.push('--config.forceCodeSigning=true')
if (developerId) {
  console.log(notarizeKey ? 'dist: Developer ID signature, notarized' : 'dist: Developer ID signature, not notarized (no APPLE_API_* env)')
} else {
  console.log('dist: no Developer ID certificate found; ad-hoc signature without hardened runtime (local use only)')
  args.push('--config.mac.identity=-', '--config.mac.hardenedRuntime=false', '--config.mac.notarize=false')
}

execFileSync(join(root, 'node_modules/.bin/electron-builder'), args, { cwd: root, stdio: 'inherit' })
