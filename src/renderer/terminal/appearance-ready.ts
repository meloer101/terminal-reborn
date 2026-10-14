// Terminals wait (briefly) for the first appearance from settings before measuring their cells, so
// a restart with a custom font does not open at the default size and then refit.

const MAX_WAIT_MS = 400
let resolveKnown: () => void = () => {}
const known = new Promise<void>((resolve) => {
  resolveKnown = resolve
})

/** Called by the appearance runtime once settings have been applied (or failed to load). */
export function markAppearanceKnown(): void {
  resolveKnown()
}

export function whenAppearanceKnown(): Promise<void> {
  return Promise.race([known, new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_MS))])
}
