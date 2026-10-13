/** Compact elapsed time for the SessionRow meta column: `<1m`, `4m`, `1h`, `2d`. */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Idle/exited sessions stay quiet in the meta column (Figma `main` row has no time). */
export function showsElapsed(status: string): boolean {
  return status !== 'idle' && status !== 'exited'
}
