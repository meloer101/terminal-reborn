/**
 * Back-pressure between a PTY and the renderer that parses its output.
 * The host pauses reading when too much output is unacknowledged, so a `cat` of a huge
 * file cannot bury the renderer, and Ctrl+C stays responsive.
 */
export const HIGH_WATERMARK = 1_000_000
export const LOW_WATERMARK = 250_000

export class FlowControl {
  private unacked = 0
  private paused = false

  /** Returns true when the PTY should be paused. */
  onOutput(length: number): boolean {
    this.unacked += length
    if (!this.paused && this.unacked > HIGH_WATERMARK) {
      this.paused = true
      return true
    }
    return false
  }

  /** Returns true when the PTY may resume. */
  onAck(count: number): boolean {
    this.unacked = Math.max(0, this.unacked - count)
    if (this.paused && this.unacked < LOW_WATERMARK) {
      this.paused = false
      return true
    }
    return false
  }
}
