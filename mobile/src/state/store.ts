// The phone's state (PRD F22): the pairing (Keychain), the link to the Mac, and what it last said — sessions, prompts
// and the conversation of the session on screen. Screens read it with useApp and talk to the Mac with call().
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import type { PhoneCommand, PhoneEvent, RemotePrompt, RemoteResult, RemoteSessionList } from '../../../src/shared/remote'
import type { ChatItem } from '../../../src/shared/transcript-chat'
import { RemoteClient, type LinkState, type Pairing } from '../protocol/client'
import { applyFeed, prependFeed, type Feed } from './model'

const PAIRING_KEY = 'wavi.pairing'

interface AppState {
  /** The Keychain was read. */
  ready: boolean
  pairing: Pairing | null
  link: LinkState
  macName: string
  sessions: RemoteSessionList
  prompts: RemotePrompt[]
  /** The session on screen and its conversation. */
  watching: string | null
  feed: (Feed & { total: number; loading: boolean }) | null
}

export const useApp = create<AppState>(() => ({
  ready: false,
  pairing: null,
  link: { kind: 'offline' },
  macName: '',
  sessions: { projects: [], sessions: [] },
  prompts: [],
  watching: null,
  feed: null
}))

let client: RemoteClient | null = null

function parsePairing(raw: string | null): Pairing | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<Pairing>
    if (typeof p.device !== 'string' || typeof p.secret !== 'string' || !Array.isArray(p.urls)) return null
    return { device: p.device, secret: p.secret, macName: typeof p.macName === 'string' ? p.macName : 'Mac', urls: p.urls.filter((u) => typeof u === 'string') }
  } catch {
    return null
  }
}

const save = (pairing: Pairing) => SecureStore.setItemAsync(PAIRING_KEY, JSON.stringify(pairing), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY })

type Page = { items: ChatItem[]; start: number; total: number }
const isPage = (data: unknown): data is Page => typeof data === 'object' && data !== null && Array.isArray((data as Page).items) && typeof (data as Page).start === 'number'

async function refresh(): Promise<void> {
  const result = await call({ type: 'snapshot' })
  if (!result.ok) return
  const data = result.data as RemoteSessionList & { prompts?: RemotePrompt[] }
  useApp.setState({ sessions: { projects: data.projects ?? [], sessions: data.sessions ?? [] }, prompts: data.prompts ?? [] })
}

function onEvent(event: PhoneEvent): void {
  switch (event.event) {
    case 'hello': {
      useApp.setState({ macName: event.data.name })
      const pairing = useApp.getState().pairing
      const urls = event.data.urls
      if (pairing && client) {
        const merged = client.setUrls(urls ?? [])
        if (merged.join() !== pairing.urls.join() || pairing.macName !== event.data.name) {
          const next = { ...pairing, urls: merged, macName: event.data.name }
          useApp.setState({ pairing: next })
          void save(next)
        }
      }
      return
    }
    case 'sessions':
      useApp.setState({ sessions: event.data })
      return
    case 'prompts':
      useApp.setState({ prompts: event.data })
      return
    case 'feed': {
      const { watching, feed } = useApp.getState()
      if (event.data.session !== watching) return
      const next = applyFeed(feed ?? undefined, event.data)
      useApp.setState({ feed: { ...next, total: next.start + next.items.length, loading: false } })
    }
  }
}

function onState(link: LinkState): void {
  useApp.setState({ link })
  if (link.kind === 'open') {
    void refresh()
    // Wavi keeps who watches what per connection: a new one has to say it again.
    const watching = useApp.getState().watching
    if (watching) void watch(watching)
  }
}

function connect(pairing: Pairing): void {
  client?.stop()
  client = new RemoteClient(pairing, { onEvent, onState })
  client.start()
}

/** Reads the Keychain once at start and connects when paired. */
export async function init(): Promise<void> {
  if (useApp.getState().ready) return
  const pairing = parsePairing(await SecureStore.getItemAsync(PAIRING_KEY))
  useApp.setState({ ready: true, pairing, macName: pairing?.macName ?? '' })
  if (pairing) connect(pairing)
}

/** Just paired. */
export async function adopt(pairing: Pairing): Promise<void> {
  await save(pairing)
  useApp.setState({ pairing, macName: pairing.macName })
  connect(pairing)
}

/** 取消配对 (also how a phone the Mac no longer knows starts over). */
export async function forget(): Promise<void> {
  client?.stop()
  client = null
  await SecureStore.deleteItemAsync(PAIRING_KEY)
  useApp.setState({ pairing: null, link: { kind: 'offline' }, sessions: { projects: [], sessions: [] }, prompts: [], watching: null, feed: null })
}

/** The app came back to the foreground. */
export const wake = (): void => client?.wake()

export const call = (command: PhoneCommand): Promise<RemoteResult> => client?.request(command) ?? Promise.resolve({ ok: false, error: '没有连上 Mac' })

/** The session on screen (null: back at the list): its newest page, then what is appended. */
export async function watch(session: string | null): Promise<void> {
  const previous = useApp.getState().watching
  if (previous !== session) useApp.setState({ watching: session, feed: session ? { start: 0, items: [], total: 0, loading: true } : null })
  const result = await call({ type: 'watch', session })
  if (!session || useApp.getState().watching !== session) return
  if (result.ok && isPage(result.data)) useApp.setState({ feed: { start: result.data.start, items: result.data.items, total: result.data.total, loading: false } })
  else useApp.setState((s) => ({ feed: s.feed ? { ...s.feed, loading: false } : null }))
}

/** The page before what is on screen (scrolled to the top). */
export async function loadOlder(): Promise<void> {
  const { watching, feed } = useApp.getState()
  if (!watching || !feed || feed.loading || feed.start === 0) return
  useApp.setState({ feed: { ...feed, loading: true } })
  const result = await call({ type: 'feed', session: watching, before: feed.start })
  const now = useApp.getState()
  if (now.watching !== watching || !now.feed) return
  const next = result.ok && isPage(result.data) ? prependFeed(now.feed, result.data) : now.feed
  useApp.setState({ feed: { ...next, total: now.feed.total, loading: false } })
}
