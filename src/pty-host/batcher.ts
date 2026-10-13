/** Coalesces PTY output so IPC carries few, large messages under floods. */
export const FLUSH_INTERVAL_MS = 8
export const FLUSH_MAX_CHARS = 64 * 1024

export class OutputBatcher {
  private buffer = ''
  private timer: ReturnType<typeof setTimeout> | null = null

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
      this.timer = setTimeout(() => this.flush(), this.intervalMs)
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
    this.emit(data)
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.buffer = ''
  }
}
