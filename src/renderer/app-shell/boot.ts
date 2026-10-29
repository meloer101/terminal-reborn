// React's side of the boot screen (public/boot.js, PRD F18 · Figma 39I): take it over once the shell is drawn, and
// remember where the welcome page's card is so the next launch draws its first frame in the same place.

/** Where the boot screen leaves the formed mark: its centre (viewport px), size (px) and angle. */
export interface BootPose {
  x: number
  y: number
  size: number
  angle: number
}

export type BootTarget = 'welcome' | 'away'

interface BootApi {
  claim(target: BootTarget, anchor?: { x: number; y: number }): Promise<BootPose | null>
}

declare global {
  interface Window {
    __waviBoot?: BootApi
  }
}

/** Read by public/boot.js before the bundle runs; keep the two in step. */
export const BOOT_LAYOUT_KEY = 'tr.boot.layout'

/** The card's insets from the window's edges and the greeting row's centre below its top edge (px). */
export interface BootLayout {
  left: number
  top: number
  right: number
  bottom: number
  anchorY: number
}

/**
 * Takes over from the boot screen. Only the first call gets the mark (null after that, without a boot screen, or under
 * reduced motion); every call is safe.
 */
export function claimBoot(target: BootTarget, anchor?: { x: number; y: number }): Promise<BootPose | null> {
  return window.__waviBoot?.claim(target, anchor).catch(() => null) ?? Promise.resolve(null)
}

export function rememberBootLayout(layout: BootLayout): void {
  try {
    localStorage.setItem(BOOT_LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Storage unavailable: the next boot screen uses the default layout.
  }
}
