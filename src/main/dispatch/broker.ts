// Between a `wavi` request (requests.ts) and the window that owns the calling session (PRD F21): each call gets an id,
// goes to that window, and its answer comes back within `wavi`'s wait. Nothing here waits for the user — `wavi run`
// answers at once and the user's 开始 / 拒绝 reaches the agent later as a message. Also remembers each Claude session's
// cross-session inbox, which `wavi` and the SessionStart hook report. No Electron here (index.ts wires it).
import { randomBytes } from 'node:crypto'
import { DISPATCH_LIMITS, parseWaviResult, waviFail, type DispatchRequest, type WaviResult } from '@shared/dispatch'
import type { Inbox, WaviCall } from './requests'

/**
 * Hook-socket events src/main/dispatch answers: Claude's SessionStart hook reports its inbox (resources/hooks/tr-hook.sh);
 * Wavi's Pi extension asks for the messages waiting for its session (resources/hooks/wavi-pi.js).
 */
export const DISPATCH_EVENTS = ['WaviInbox', 'WaviMessages'] as const
export const isDispatchEvent = (event: string): boolean => (DISPATCH_EVENTS as readonly string[]).includes(event)

/** Under `wavi`'s own 5 s, so its answer is ours, not its timeout. */
export const ANSWER_MS = DISPATCH_LIMITS.responseMs - 700
const DEADLINE_MARGIN_MS = 300

export interface BrokerOptions<O> {
  /** The window that shows the session; null when none does (the call then says Wavi is unavailable). */
  ownerOf: (sessionId: string) => O | null
  send: (owner: O, request: DispatchRequest) => void
  answerMs?: number
}

interface Call<O> {
  owner: O
  resolve: (result: WaviResult) => void
}

export class DispatchBroker<O> {
  private readonly calls = new Map<string, Call<O>>()
  private readonly inboxes = new Map<string, Inbox>()

  constructor(private readonly options: BrokerOptions<O>) {}

  /** Claude's cross-session inbox of this session, as `wavi` or its SessionStart hook reported it. */
  inboxOf(sessionId: string): Inbox | undefined {
    return this.inboxes.get(sessionId)
  }

  setInbox(sessionId: string, inbox: Inbox): void {
    this.inboxes.set(sessionId, inbox)
  }

  call({ sessionId, command, inbox }: WaviCall): Promise<WaviResult> {
    if (inbox) this.setInbox(sessionId, inbox)
    const owner = this.options.ownerOf(sessionId)
    if (owner === null) return Promise.resolve(waviFail('wavi_unavailable', 'No Wavi window has this session open right now. Try again later, or ask the user.'))
    const callId = randomBytes(12).toString('hex')
    const answerMs = this.options.answerMs ?? ANSWER_MS
    // A little before our own timeout, so the window stops before we tell `wavi` it did not answer.
    const deadline = Date.now() + answerMs - DEADLINE_MARGIN_MS
    return new Promise<WaviResult>((resolve) => {
      const timer = setTimeout(() => {
        this.calls.delete(callId)
        resolve(waviFail('wavi_unavailable', 'Wavi did not answer in time; nothing was done. Try again in a moment.'))
      }, answerMs)
      this.calls.set(callId, {
        owner,
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        }
      })
      this.options.send(owner, { callId, sessionId, command, deadline })
    })
  }

  /** The window's answer to a request it was sent; ignored unless it comes from the window that was asked. */
  answer(owner: O, callId: string, raw: unknown): void {
    const call = this.calls.get(callId)
    if (!call || call.owner !== owner) return
    this.calls.delete(callId)
    call.resolve(parseWaviResult(raw) ?? waviFail('failed', 'Wavi gave an answer it could not read.'))
  }
}
