/**
 * Back-pressure between a PTY and the renderer that parses its output.
 * The host pauses reading when too much output is unacknowledged, so a `cat` of a huge
 * file cannot bury the renderer, and Ctrl+C stays responsive.
 *
 * A session no pane shows gets far less room: the daemon relays every session on one thread and one socket, so a
 * shown session's echo waits behind whatever the hidden ones have in flight (10 hidden sessions × 1 MB at ~26 MB/s put
 * ~400 ms in front of each keystroke, `e2e/scale.spec.ts -g burst`).
 */
export const HIGH_WATERMARK = 1_000_000
export const LOW_WATERMARK = 250_000
export const HIDDEN_HIGH_WATERMARK = 128_000
/** At least the renderer's ack batch (32 KiB, session-terminal.ts), or the last partial batch waits for its 50 ms timer. */
export const HIDDEN_LOW_WATERMARK = 64_000

export class FlowControl {
  private unacked = 0
  private paused = false
  private visible = true

  private get high(): number {
    return this.visible ? HIGH_WATERMARK : HIDDEN_HIGH_WATERMARK
  }

  private get low(): number {
    return this.visible ? LOW_WATERMARK : HIDDEN_LOW_WATERMARK
  }

  /** Returns true when the PTY should be paused. */
  onOutput(length: number): boolean {
    this.unacked += length
    if (!this.paused && this.unacked > this.high) {
      this.paused = true
      return true
    }
    return false
  }

  /** Returns true when the PTY may resume. */
  onAck(count: number): boolean {
    this.unacked = Math.max(0, this.unacked - count)
    if (this.paused && this.unacked < this.low) {
      this.paused = false
      return true
    }
    return false
  }

  /** A pane started or stopped showing the session: what the PTY should do now under the other watermarks, if anything. */
  setVisible(visible: boolean): 'pause' | 'resume' | null {
    this.visible = visible
    if (!this.paused && this.unacked > this.high) {
      this.paused = true
      return 'pause'
    }
    if (this.paused && this.unacked < this.low) {
      this.paused = false
      return 'resume'
    }
    return null
  }
}
