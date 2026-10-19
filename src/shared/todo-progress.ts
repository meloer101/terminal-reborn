// The agent's todo list from its todo tools (PRD F12, §6.6). Pure.
// Claude 2.1.301–2.1.303 has two families, both seen in PostToolUse:
//   TaskCreate { subject, activeForm? } -> response { task: { id } };  TaskUpdate { taskId, status?, subject?, activeForm? }
//   TodoWrite  { todos: [{ content, status, activeForm }] } (always the whole list)
// Only successful calls (PostToolUse) are applied: the TaskCreate id exists only in the response.

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  text: string
  /** The present-tense form the TUI shows while the item runs ("Running tests"). */
  activeText?: string
  status: TodoStatus
}

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** Keeps a runaway list from flooding IPC and the UI. */
export const MAX_TODOS = 100
const MAX_TEXT = 200

const STATUSES: ReadonlySet<string> = new Set<TodoStatus>(['pending', 'in_progress', 'completed'])

const clip = (value: string): string => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value)

function id(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const s = text(value)
  return s && s.length <= 64 ? s : undefined
}

export function isTodoTool(tool: string): boolean {
  return tool === 'TaskCreate' || tool === 'TaskUpdate' || tool === 'TodoWrite'
}

/**
 * The list after one successful todo-tool call, or null when the call changes nothing we can read
 * (unknown tool, malformed input, an update for an id we never saw).
 */
export function applyTodoTool(items: readonly TodoItem[], tool: string, input: unknown, response: unknown): TodoItem[] | null {
  if (!isRec(input)) return null
  switch (tool) {
    case 'TodoWrite': {
      if (!Array.isArray(input.todos)) return null
      const next: TodoItem[] = []
      for (const [index, raw] of input.todos.entries()) {
        if (!isRec(raw)) continue
        const content = text(raw.content)
        if (!content) continue
        const activeText = text(raw.activeForm)
        next.push({
          id: id(raw.id) ?? String(index + 1),
          text: clip(content),
          ...(activeText ? { activeText: clip(activeText) } : {}),
          status: typeof raw.status === 'string' && STATUSES.has(raw.status) ? (raw.status as TodoStatus) : 'pending'
        })
        if (next.length >= MAX_TODOS) break
      }
      return next
    }
    case 'TaskCreate': {
      const subject = text(input.subject) ?? text(input.description)
      if (!subject || items.length >= MAX_TODOS) return null
      const created = isRec(response) && isRec(response.task) ? id(response.task.id) : undefined
      const activeText = text(input.activeForm)
      return [
        ...items,
        {
          // Without a response id fall back to Claude's own numbering (1, 2, 3 … per list).
          id: created ?? String(items.length + 1),
          text: clip(subject),
          ...(activeText ? { activeText: clip(activeText) } : {}),
          status: 'pending'
        }
      ]
    }
    case 'TaskUpdate': {
      const taskId = id(input.taskId)
      const index = taskId === undefined ? -1 : items.findIndex((item) => item.id === taskId)
      const current = items[index]
      if (!current) return null
      if (input.status === 'deleted') return items.filter((_, i) => i !== index)
      const subject = text(input.subject)
      const activeText = text(input.activeForm)
      const updated: TodoItem = {
        ...current,
        ...(subject ? { text: clip(subject) } : {}),
        ...(activeText ? { activeText: clip(activeText) } : {}),
        ...(typeof input.status === 'string' && STATUSES.has(input.status) ? { status: input.status as TodoStatus } : {})
      }
      return items.map((item, i) => (i === index ? updated : item))
    }
    default:
      return null
  }
}

export function sameTodos(a: readonly TodoItem[], b: readonly TodoItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => {
      const other = b[i]
      return other !== undefined && item.id === other.id && item.text === other.text && item.status === other.status && item.activeText === other.activeText
    })
  )
}

export interface TodoProgress {
  done: number
  total: number
  /** The in-progress item, else the next pending one; the last item once all are done (Figma 17B 全部完成). */
  current: string
  allDone: boolean
}

export function todoProgress(items: readonly TodoItem[]): TodoProgress | null {
  const last = items[items.length - 1]
  if (!last) return null
  const done = items.filter((item) => item.status === 'completed').length
  const active = items.find((item) => item.status === 'in_progress') ?? items.find((item) => item.status === 'pending')
  return { done, total: items.length, current: (active ?? last).text, allDone: done === items.length }
}

/** How a TodoPopover row reads: done ✓, the current one highlighted, the rest pending. */
export function todoRowState(items: readonly TodoItem[], index: number): 'done' | 'current' | 'pending' {
  const item = items[index]
  if (!item || item.status === 'completed') return 'done'
  const firstOpen = items.findIndex((i) => i.status === 'in_progress')
  const current = firstOpen >= 0 ? firstOpen : items.findIndex((i) => i.status === 'pending')
  return index === current ? 'current' : 'pending'
}
