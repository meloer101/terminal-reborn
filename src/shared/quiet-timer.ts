// Fires once input has been quiet for a period, without re-arming a timer per input: `touch()` only records the
// time, and the single pending timer re-arms itself for the remainder when it finds the input was not quiet yet.
// Terminal output arrives in many chunks a second; clearTimeout + setTimeout on each was measurable work.

export class QuietTimer {
  private last = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly quietMs: number,
    private readonly fire: () => void,
    private readonly now: () => number = () => performance.now()
  ) {}

  /** Input happened: `fire` runs once nothing more has happened for `quietMs`. */
  touch(): void {
    this.last = this.now()
    this.timer ??= setTimeout(this.check, this.quietMs)
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** A `fire` is pending. */
  get armed(): boolean {
    return this.timer !== null
  }

  private readonly check = (): void => {
    const left = this.last + this.quietMs - this.now()
    if (left > 0) {
      this.timer = setTimeout(this.check, left)
      return
    }
    this.timer = null
    this.fire()
  }
}
