import { useEffect, useState } from 'react'

const read = (): string => getComputedStyle(document.documentElement).getPropertyValue('--term-bg').trim()

/**
 * The terminal background the app theme gives (`--term-bg`), kept current when <html data-theme> flips. Only
 * meaningful while the 底色 follows the theme: a custom color sets --term-bg on <html> itself.
 */
export function useThemeBackground(): string {
  const [color, setColor] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setColor(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => observer.disconnect()
  }, [])
  return color
}
