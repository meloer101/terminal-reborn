#!/bin/bash
# Builds two small demo repos with worktrees for README screenshots.
set -euo pipefail
ROOT="$1"
rm -rf "$ROOT"
mkdir -p "$ROOT/worktrees"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME="Jacob" GIT_AUTHOR_EMAIL="jacob@example.com" GIT_COMMITTER_NAME="Jacob" GIT_COMMITTER_EMAIL="jacob@example.com"
T0=$(( $(date +%s) - 2*86400 ))
n=0
commit() { # message
  n=$((n+1)); local t=$((T0 + n*2400))
  git add -A
  GIT_AUTHOR_DATE="@$t" GIT_COMMITTER_DATE="@$t" git commit -q -m "$1"
}
merge() { # branch message
  n=$((n+1)); local t=$((T0 + n*2400))
  GIT_AUTHOR_DATE="@$t" GIT_COMMITTER_DATE="@$t" git merge -q --no-ff "$1" -m "$2"
}
w() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

# ---------------------------------------------------------------- acme-web
R="$ROOT/acme-web"; mkdir -p "$R"; cd "$R"
git init -q -b main
git config user.name jacob; git config user.email jacob@example.com
w package.json <<'EOF'
{
  "name": "acme-web",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test", "build": "tsc -p ." }
}
EOF
w README.md <<'EOF'
# acme-web

Storefront for Acme. `npm test` runs the unit tests.
EOF
w .gitignore <<'EOF'
node_modules
dist
.env
EOF
commit "chore: scaffold storefront"

w src/checkout/price.js <<'EOF'
// Prices are integers in cents.
export function lineTotal(item) {
  return item.unitPrice * item.quantity
}

export function cartTotal(items, { taxRate = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0)
  return Math.round(subtotal * (1 + taxRate))
}
EOF
w test/price.test.js <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartTotal } from '../src/checkout/price.js'

test('cart total includes tax', () => {
  assert.equal(cartTotal([{ unitPrice: 1000, quantity: 2 }], { taxRate: 0.1 }), 2200)
})
EOF
commit "feat(checkout): cart totals with tax"

w src/auth/session.js <<'EOF'
const KEY = 'acme.session'

// Keeps the signed-in user's session token in localStorage.
export function saveSession(storage, session) {
  storage.setItem(KEY, JSON.stringify(session))
}

export function loadSession(storage) {
  const raw = storage.getItem(KEY)
  if (!raw) return null
  const session = JSON.parse(raw)
  return session.expiresAt > Date.now() ? session : null
}

export function clearSession(storage) {
  storage.removeItem(KEY)
}
EOF
w test/session.test.js <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveSession, loadSession } from '../src/auth/session.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

test('a saved session loads back until it expires', () => {
  const storage = memoryStorage()
  saveSession(storage, { token: 't', expiresAt: Date.now() + 60_000 })
  assert.equal(loadSession(storage).token, 't')
})
EOF
commit "feat(auth): persist sessions"

w src/components/MobileNav.js <<'EOF'
export function MobileNav({ open, onToggle }) {
  return `
    <nav class="mobile-nav ${open ? 'is-open' : ''}">
      <button class="mobile-nav__toggle" aria-expanded="${open}" onclick="${onToggle}">Menu</button>
      <ul class="mobile-nav__links">
        <li><a href="/shop">Shop</a></li>
        <li><a href="/cart">Cart</a></li>
        <li><a href="/account">Account</a></li>
      </ul>
    </nav>`
}
EOF
w src/styles/nav.css <<'EOF'
.mobile-nav { position: sticky; top: 0; }
.mobile-nav__links { height: auto; transition: height 200ms ease; }
.mobile-nav.is-open .mobile-nav__links { height: auto; }
EOF
commit "feat(nav): mobile navigation"

git switch -q -c jacob/docs-roadmap
w docs/ROADMAP.md <<'EOF'
# Roadmap

- Saved carts
- Gift cards
- Faster checkout
EOF
commit "docs: roadmap"
git switch -q main
merge jacob/docs-roadmap "Merge branch 'jacob/docs-roadmap'"

w src/search/index.js <<'EOF'
// Builds a lowercase token index over product titles.
export function buildIndex(products) {
  const index = new Map()
  for (const product of products) {
    for (const token of product.title.toLowerCase().split(/\s+/)) {
      if (!index.has(token)) index.set(token, new Set())
      index.get(token).add(product.id)
    }
  }
  return index
}
EOF
commit "feat(search): product title index"
git tag v0.4.0
BASE_OLD=$(git rev-parse HEAD)

w package.json <<'EOF'
{
  "name": "acme-web",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test", "build": "tsc -p ." }
}
EOF
commit "chore: require Node 22"

git switch -q -c jacob/fix-tax-rounding
w src/checkout/price.js <<'EOF'
// Prices are integers in cents.
export function lineTotal(item) {
  return item.unitPrice * item.quantity
}

export function cartTotal(items, { taxRate = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0)
  // Round tax on its own so totals match the receipt.
  return subtotal + Math.round(subtotal * taxRate)
}
EOF
commit "fix(checkout): round tax separately"
git switch -q main
merge jacob/fix-tax-rounding "Merge branch 'jacob/fix-tax-rounding'"
git tag v0.4.1

# Worktrees, one per agent.
wt() { git worktree add -q -b "$1" "$ROOT/worktrees/acme-web/$2" "${3:-main}"; }
wt jacob/session-cookie session-cookie
wt jacob/checkout-perf checkout-perf "$BASE_OLD"
wt jacob/mobile-nav-jitter mobile-nav-jitter
wt jacob/search-ranking search-ranking
wt jacob/i18n-copy i18n-copy

# checkout-perf (Codex): two commits on an older base.
cd "$ROOT/worktrees/acme-web/checkout-perf"
w src/checkout/price.js <<'EOF'
// Prices are integers in cents.
const totals = new WeakMap()

export function lineTotal(item) {
  return item.unitPrice * item.quantity
}

// Cart totals are memoized per items array: the cart re-renders on every keystroke.
export function cartTotal(items, { taxRate = 0 } = {}) {
  const cached = totals.get(items)
  if (cached && cached.taxRate === taxRate) return cached.total
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0)
  const total = Math.round(subtotal * (1 + taxRate))
  totals.set(items, { taxRate, total })
  return total
}
EOF
commit "perf(checkout): memoize cart totals"
w src/checkout/prefetch.js <<'EOF'
// Prefetches shipping quotes while the customer is still on the cart page.
export function prefetchQuotes(fetchQuote, address) {
  if (!address?.postcode) return Promise.resolve(null)
  return fetchQuote(address).catch(() => null)
}
EOF
commit "perf(checkout): prefetch shipping quotes"

# mobile-nav-jitter (Claude, done): the fix to review.
cd "$ROOT/worktrees/acme-web/mobile-nav-jitter"
w src/styles/nav.css <<'EOF'
.mobile-nav { position: sticky; top: 0; contain: layout; }
.mobile-nav__links {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease;
}
.mobile-nav__links > * { overflow: hidden; }
.mobile-nav.is-open .mobile-nav__links { grid-template-rows: 1fr; }
EOF
commit "fix(nav): animate the menu with grid rows instead of height"
w src/components/MobileNav.js <<'EOF'
export function MobileNav({ open, onToggle }) {
  return `
    <nav class="mobile-nav ${open ? 'is-open' : ''}">
      <button class="mobile-nav__toggle" aria-expanded="${open}" aria-controls="mobile-nav-links" onclick="${onToggle}">Menu</button>
      <ul class="mobile-nav__links" id="mobile-nav-links">
        <li><a href="/shop">Shop</a></li>
        <li><a href="/cart">Cart</a></li>
        <li><a href="/account">Account</a></li>
      </ul>
    </nav>`
}
EOF
w test/nav.test.js <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MobileNav } from '../src/components/MobileNav.js'

test('the toggle controls the link list', () => {
  const html = MobileNav({ open: true, onToggle: 'toggle()' })
  assert.match(html, /aria-controls="mobile-nav-links"/)
  assert.match(html, /id="mobile-nav-links"/)
})
EOF
commit "fix(nav): link the toggle to the menu for screen readers"

# search-ranking (Claude, error): a commit that breaks the build.
cd "$ROOT/worktrees/acme-web/search-ranking"
w src/search/rank.js <<'EOF'
import { buildIndex } from './index.js'

// Ranks products by how many query tokens hit their title.
export function rank(products, query) {
  const index = buildIndex(products)
  const hits = new Map()
  for (const token of query.toLowerCase().split(/\s+/)) {
    for (const id of index.get(token) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1)
  }
  return [...hits].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
EOF
commit "feat(search): rank results by token hits"

# i18n-copy (Codex): one commit plus work in progress.
cd "$ROOT/worktrees/acme-web/i18n-copy"
w src/i18n/en.json <<'EOF'
{ "nav.shop": "Shop", "nav.cart": "Cart", "nav.account": "Account" }
EOF
commit "feat(i18n): extract navigation strings"
w src/i18n/de.json <<'EOF'
{ "nav.shop": "Shop", "nav.cart": "Warenkorb", "nav.account": "Konto" }
EOF

# session-cookie (Claude, live): one commit; the agent works on top of it.
cd "$ROOT/worktrees/acme-web/session-cookie"
w src/auth/cookie.js <<'EOF'
// Serializes a session cookie the server can read and scripts cannot.
export function sessionCookie(token, { maxAge = 60 * 60 * 24 * 7 } = {}) {
  return `acme_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`
}
EOF
commit "feat(auth): session cookie helper"

# ---------------------------------------------------------------- billing-api
R2="$ROOT/billing-api"; mkdir -p "$R2"; cd "$R2"
git init -q -b main
git config user.name jacob; git config user.email jacob@example.com
w package.json <<'EOF'
{ "name": "billing-api", "private": true, "type": "module", "scripts": { "test": "node --test" } }
EOF
commit "chore: scaffold billing api"
w src/webhooks.js <<'EOF'
export async function handleWebhook(event, { charge }) {
  if (event.type === 'invoice.paid') await charge.markPaid(event.data.id)
}
EOF
commit "feat: invoice webhooks"
git worktree add -q -b jacob/webhook-retries "$ROOT/worktrees/billing-api/webhook-retries"
git worktree add -q -b jacob/vite-7 "$ROOT/worktrees/billing-api/vite-7"
cd "$ROOT/worktrees/billing-api/webhook-retries"
w src/retry.js <<'EOF'
// Retries a webhook delivery with exponential backoff: 1s, 2s, 4s, …
export async function withRetry(fn, { attempts = 5, base = 1000, sleep } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (error) { if (i + 1 >= attempts) throw error }
    await sleep(base * 2 ** i)
  }
}
EOF
commit "feat: retry webhook deliveries with backoff"
echo "done: $ROOT"
