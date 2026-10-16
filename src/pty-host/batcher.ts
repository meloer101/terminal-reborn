/**
 * Coalesces PTY output so IPC carries few, large messages under floods — without adding latency to
 * interactive output: the first chunk after a quiet spell goes out on the next turn of the event loop
 * (a TUI redraw that arrives in several reads still travels together); only sustained output waits for
 * the interval. A full-screen agent redraws on every scroll step, so this delay is felt directly.
 */
export const FLUSH_INTERVAL_MS = 8
export const FLUSH_MAX_CHARS = 64 * 1024

export class OutputBatcher {
  private buffer = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastFlushAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly emit: (data: string) => void,
    private readonly intervalMs = FLUSH_INTERVAL_MS,
    private readonly maxChars = FLUSH_MAX_CHARS
  ) {}

  append(data: string): void {
    if (data.length === 0) return
    this.buffer += data
    if (this.buffer.length >= this.maxChars) {
      this.flush()
    } else if (this.timer === null) {
      const idle = Date.now() - this.lastFlushAt >= this.intervalMs
      this.timer = setTimeout(() => this.flush(), idle ? 0 : this.intervalMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return
    const data = this.buffer
    this.buffer = ''
    this.lastFlushAt = Date.now()
    this.emit(data)
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.buffer = ''
  }
}
