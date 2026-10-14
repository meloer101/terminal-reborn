// Renders nothing; keeps session status, notifications and the Dock badge in sync with agent / PTY signals.
// The logic lives in controller.ts (pure, tested) and bridge.ts (wiring).
import { useEffect } from 'react'
import { startStatusBridge } from './bridge'

export function StatusBridge() {
  useEffect(() => startStatusBridge(), [])
  return null
}
