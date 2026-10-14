// Mounted by AppShell; renders nothing. Keeps the window in step with AppSettings.appearance.
import { useEffect } from 'react'
import { watchAppearance } from './runtime'

export function AppearanceBridge() {
  useEffect(() => watchAppearance(), [])
  return null
}
