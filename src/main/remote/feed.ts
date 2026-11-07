// A session's conversation for the phone (PRD F22, Figma 45C): its transcript read incrementally into chat items
// (@shared/transcript-chat), pages on request, and what is appended pushed to the phones watching it. A file is only
// read while a phone looks at its session. Electron-free: index.ts says where each session's transcript is.
import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { createChatParser, type ChatItem, type ChatParser } from '@shared/transcript-chat'
import { REMOTE_LIMITS, type PhoneEvent } from '@shared/remote'

export interface FeedSource {
  agent: 'claude' | 'codex'
  path: string
}

/** A first read of a long transcript starts this far from its end (older turns are not on a phone screen anyway). */
const FIRST_READ_BYTES = 32 * 1024 * 1024
const CHUNK_BYTES = 4 * 1024 * 1024
/** fs.watch fires per write; one read per burst. */
const SETTLE_MS = 120

/** Items as the phone gets them: a tool's full command (`input`, up to 2000 characters) stays here, the phone shows `arg`. */
function forPhone(items: readonly ChatItem[]): ChatItem[] {
  return items.map((item) => {
    if (item.kind !== 'tool' || item.input === undefined) return item
    const { input: _input, ...rest } = item
    return rest
  })
}

interface Reader {
  source: FeedSource
  parser: ChatParser
  offset: number
  carry: string
  /** Keeps a character cut by a chunk (or a half-written line) whole across reads. */
  decoder: StringDecoder
  /** The file shrank and was read again from the start: the watchers get everything anew. */
  reset: boolean
  watchers: Set<string>
  watcher: FSWatcher | null
  timer: NodeJS.Timeout | null
  reading: Promise<number[]> | null
}

export interface FeedHubOptions {
  sourceOf: (sessionId: string) => FeedSource | null
  push: (connectionId: string, event: PhoneEvent) => void
  /** Tests replace the file watcher. */
  watchFile?: (path: string, onChange: () => void) => FSWatcher | null
}

export class FeedHub {
  private readonly readers = new Map<string, Reader>()
  /** Which session each connection watches. */
  private readonly watching = new Map<string, string>()
  /** Connections watching a session whose transcript is not known yet (its agent has not started): served once it is. */
  private readonly pending = new Map<string, Set<string>>()

  constructor(private readonly options: FeedHubOptions) {}

  /** A page of the session's items ending before `before` (the newest page without it); null when there is no transcript. */
  async page(sessionId: string, before?: number): Promise<{ items: ChatItem[]; start: number; total: number } | null> {
    const reader = this.readerFor(sessionId)
    if (!reader) return null
    const primed = reader.offset >= 0
    const changed = await this.pull(sessionId, reader)
    // What this read found is news to the phones already watching (a first read is not: they get it as this page).
    if (primed) this.publish(sessionId, reader, changed)
    const items = reader.parser.items
    const end = Math.min(before ?? items.length, items.length)
    const start = Math.max(0, end - REMOTE_LIMITS.feedPage)
    const page = { items: forPhone(items.slice(start, end)), start, total: items.length }
    this.release(sessionId)
    return page
  }

  /** The connection now looks at `sessionId` (null: at the list). */
  watch(connectionId: string, sessionId: string | null): void {
    const previous = this.watching.get(connectionId)
    if (previous === sessionId) return
    if (previous) {
      this.watching.delete(connectionId)
      this.readers.get(previous)?.watchers.delete(connectionId)
      this.pending.get(previous)?.delete(connectionId)
      if (this.pending.get(previous)?.size === 0) this.pending.delete(previous)
      this.release(previous)
    }
    if (!sessionId) return
    this.watching.set(connectionId, sessionId)
    const reader = this.readerFor(sessionId)
    if (!reader) {
      this.pending.set(sessionId, (this.pending.get(sessionId) ?? new Set()).add(connectionId))
      return
    }
    reader.watchers.add(connectionId)
    if (!reader.watcher) {
      const onChange = () => this.schedule(sessionId)
      reader.watcher = (this.options.watchFile ?? defaultWatch)(reader.source.path, onChange)
    }
  }

  /** The connection closed. */
  drop(connectionId: string): void {
    this.watch(connectionId, null)
  }

  /** A hook of the session fired: something may have been appended (and fs.watch can miss writes), or it moved to another file. */
  nudge(sessionId: string): void {
    if (!this.readers.get(sessionId)?.watchers.size && !this.pending.has(sessionId)) return
    this.readerFor(sessionId)
    this.schedule(sessionId)
  }

  /** Where sessions' transcripts are may have changed (the window's list): serve the phones still waiting for one. */
  retry(): void {
    for (const sessionId of [...this.pending.keys()]) this.nudge(sessionId)
  }

  stop(): void {
    for (const id of [...this.readers.keys()]) this.dispose(id)
    this.watching.clear()
    this.pending.clear()
  }

  private readerFor(sessionId: string): Reader | null {
    const source = this.options.sourceOf(sessionId)
    const existing = this.readers.get(sessionId)
    if (existing && source && existing.source.path === source.path) return existing
    if (!source) return existing ?? null
    // A new file (the conversation was cleared or resumed into another one, or the agent started for phones that were
    // waiting): start over and tell the watchers; their next push is the newest page.
    const watchers = existing?.watchers ?? this.pending.get(sessionId) ?? new Set<string>()
    this.pending.delete(sessionId)
    if (existing) this.dispose(sessionId)
    const reader: Reader = { source, parser: createChatParser(source.agent), offset: -1, carry: '', decoder: new StringDecoder('utf8'), reset: watchers.size > 0, watchers, watcher: null, timer: null, reading: null }
    this.readers.set(sessionId, reader)
    if (watchers.size > 0) {
      reader.watcher = (this.options.watchFile ?? defaultWatch)(source.path, () => this.schedule(sessionId))
      for (const id of watchers) this.options.push(id, { event: 'feed', data: { session: sessionId, items: [], start: 0, reset: true } })
    }
    return reader
  }

  private release(sessionId: string): void {
    const reader = this.readers.get(sessionId)
    if (reader && reader.watchers.size === 0) this.dispose(sessionId)
  }

  private dispose(sessionId: string): void {
    const reader = this.readers.get(sessionId)
    if (!reader) return
    reader.watcher?.close()
    if (reader.timer) clearTimeout(reader.timer)
    this.readers.delete(sessionId)
  }

  private schedule(sessionId: string): void {
    const reader = this.readers.get(sessionId)
    if (!reader) return
    if (reader.timer) clearTimeout(reader.timer)
    reader.timer = setTimeout(() => {
      reader.timer = null
      void this.pull(sessionId, reader).then((changed) => this.publish(sessionId, reader, changed))
    }, SETTLE_MS)
  }

  private publish(sessionId: string, reader: Reader, changed: number[]): void {
    if (this.readers.get(sessionId) !== reader) return
    if (reader.reset) {
      reader.reset = false
      const items = forPhone(reader.parser.items.slice(-REMOTE_LIMITS.feedPage))
      const start = reader.parser.items.length - items.length
      for (const id of reader.watchers) this.options.push(id, { event: 'feed', data: { session: sessionId, items, start, reset: true } })
      return
    }
    if (changed.length === 0) return
    const start = Math.min(...changed)
    const items = forPhone(reader.parser.items.slice(start))
    for (const id of reader.watchers) this.options.push(id, { event: 'feed', data: { session: sessionId, items, start } })
  }

  /** Reads what was appended since the last read; returns the indexes of items added or changed. */
  private pull(sessionId: string, reader: Reader): Promise<number[]> {
    if (reader.reading) return reader.reading.then(() => this.pull(sessionId, reader))
    reader.reading = readMore(reader).finally(() => {
      reader.reading = null
    })
    return reader.reading
  }
}

function defaultWatch(path: string, onChange: () => void): FSWatcher | null {
  try {
    const watcher = watch(path, { persistent: false }, onChange)
    watcher.on('error', () => watcher.close())
    return watcher
  } catch {
    return null
  }
}

async function readMore(reader: Reader): Promise<number[]> {
  let size: number
  try {
    size = (await stat(reader.source.path)).size
  } catch {
    return []
  }
  // The file shrank (rewritten): read it again from the start, into a fresh parser.
  if (reader.offset >= 0 && size < reader.offset) {
    reader.parser = createChatParser(reader.source.agent)
    reader.offset = 0
    reader.carry = ''
    reader.decoder = new StringDecoder('utf8')
    reader.reset = true
  }
  if (reader.offset < 0) reader.offset = Math.max(0, size - FIRST_READ_BYTES)
  // A first read that starts inside the file starts inside a line: that line is dropped.
  const skipFirstLine = reader.offset > 0 && reader.parser.items.length === 0 && reader.carry === ''
  if (size === reader.offset) return []
  const changed = new Set<number>()
  const handle = await open(reader.source.path, 'r')
  try {
    let first = skipFirstLine
    while (reader.offset < size) {
      const length = Math.min(CHUNK_BYTES, size - reader.offset)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, reader.offset)
      if (bytesRead === 0) break
      reader.offset += bytesRead
      const text = reader.carry + reader.decoder.write(buffer.subarray(0, bytesRead))
      const lines = text.split('\n')
      reader.carry = lines.pop() ?? ''
      if (first) {
        lines.shift()
        first = false
      }
      for (const line of lines) for (const index of reader.parser.push(line)) changed.add(index)
    }
  } finally {
    await handle.close()
  }
  return [...changed].sort((a, b) => a - b)
}
