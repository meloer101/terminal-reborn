// Keys the composer forwards straight to the agent when its input is empty (PRD F1 "直通").

export type PassthroughKey = 'escape' | 'up' | 'down' | 'shift-tab' | 'ctrl-c'

export const PASSTHROUGH_BYTES: Record<PassthroughKey, string> = {
  escape: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  'shift-tab': '\x1b[Z',
  'ctrl-c': '\x03'
}
