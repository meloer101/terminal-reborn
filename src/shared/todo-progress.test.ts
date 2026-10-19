import { describe, expect, it } from 'vitest'
import { applyTodoTool, isTodoTool, MAX_TODOS, sameTodos, todoProgress, todoRowState, type TodoItem } from './todo-progress'

// Shapes captured from Claude Code 2.1.301 (PRD §6.6); 2.1.303 has the same tools.
function runTasks(): TodoItem[] {
  let items: TodoItem[] = []
  const step = (tool: string, input: unknown, response?: unknown): void => {
    items = applyTodoTool(items, tool, input, response) ?? items
  }
  step('TaskCreate', { subject: 'alpha step', description: 'alpha step' }, { task: { id: '1', subject: 'alpha step' } })
  step('TaskCreate', { subject: 'beta step', description: 'beta step' }, { task: { id: '2', subject: 'beta step' } })
  step('TaskCreate', { subject: 'gamma step', description: 'gamma step' }, { task: { id: '3', subject: 'gamma step' } })
  step('TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true, taskId: '1' })
  step('TaskUpdate', { taskId: '1', status: 'completed' }, { success: true, taskId: '1' })
  step('TaskUpdate', { taskId: '2', status: 'in_progress' }, { success: true, taskId: '2' })
  return items
}

describe('applyTodoTool', () => {
  it('follows TaskCreate / TaskUpdate by the response id', () => {
    const items = runTasks()
    expect(items.map((i) => [i.id, i.text, i.status])).toEqual([
      ['1', 'alpha step', 'completed'],
      ['2', 'beta step', 'in_progress'],
      ['3', 'gamma step', 'pending']
    ])
    expect(todoProgress(items)).toEqual({ done: 1, total: 3, current: 'beta step', allDone: false })
  })

  it('replaces the whole list on TodoWrite', () => {
    const todos = [
      { content: 'alpha step', status: 'completed', activeForm: 'Working on alpha step' },
      { content: 'beta step', status: 'in_progress', activeForm: 'Working on beta step' },
      { content: 'gamma step', status: 'pending', activeForm: 'Working on gamma step' }
    ]
    const items = applyTodoTool(runTasks(), 'TodoWrite', { todos }, { oldTodos: [], newTodos: todos })
    expect(items).toHaveLength(3)
    expect(items?.[1]).toEqual({ id: '2', text: 'beta step', activeText: 'Working on beta step', status: 'in_progress' })
    expect(applyTodoTool([], 'TodoWrite', { todos: [] }, undefined)).toEqual([])
  })

  it('handles subject edits, deletes and unknown ids', () => {
    const items = runTasks()
    expect(applyTodoTool(items, 'TaskUpdate', { taskId: '3', subject: 'gamma, renamed' }, {})?.[2]?.text).toBe('gamma, renamed')
    expect(applyTodoTool(items, 'TaskUpdate', { taskId: '2', status: 'deleted' }, {})?.map((i) => i.id)).toEqual(['1', '3'])
    expect(applyTodoTool(items, 'TaskUpdate', { taskId: '9', status: 'completed' }, {})).toBeNull()
    expect(applyTodoTool(items, 'TaskUpdate', { taskId: '1', status: 'bogus' }, {})?.[0]?.status).toBe('completed')
  })

  it('numbers TaskCreate itself when the response has no id', () => {
    expect(applyTodoTool([], 'TaskCreate', { subject: 'x' }, undefined)).toEqual([{ id: '1', text: 'x', status: 'pending' }])
  })

  it('ignores other tools and malformed input', () => {
    expect(applyTodoTool([], 'Bash', { command: 'ls' }, {})).toBeNull()
    expect(applyTodoTool([], 'TodoWrite', { todos: 'nope' }, {})).toBeNull()
    expect(applyTodoTool([], 'TaskCreate', { subject: '  ' }, {})).toBeNull()
    expect(applyTodoTool([], 'TaskCreate', 'nope', {})).toBeNull()
    expect(applyTodoTool([], 'TodoWrite', { todos: [null, { status: 'pending' }, { content: 'ok', status: 7 }] }, {})).toEqual([
      { id: '3', text: 'ok', status: 'pending' }
    ])
  })

  it('caps the list', () => {
    const todos = Array.from({ length: MAX_TODOS + 20 }, (_, i) => ({ content: `t${i}`, status: 'pending' }))
    expect(applyTodoTool([], 'TodoWrite', { todos }, {})).toHaveLength(MAX_TODOS)
  })

  it('knows its tools', () => {
    expect(isTodoTool('TaskUpdate')).toBe(true)
    expect(isTodoTool('TaskList')).toBe(false)
  })
})

describe('todoProgress', () => {
  it('is null for an empty list and shows the last item when all are done (7/7 stays until the next list)', () => {
    expect(todoProgress([])).toBeNull()
    expect(
      todoProgress([
        { id: '1', text: 'a', status: 'completed' },
        { id: '2', text: 'b', status: 'completed' }
      ])
    ).toEqual({ done: 2, total: 2, current: 'b', allDone: true })
  })

  it('falls back to the next pending item', () => {
    expect(
      todoProgress([
        { id: '1', text: 'a', status: 'completed' },
        { id: '2', text: 'b', status: 'pending' }
      ])
    ).toEqual({ done: 1, total: 2, current: 'b', allDone: false })
  })
})

describe('todoRowState', () => {
  it('marks done items, the one in progress (else the first pending) and the rest', () => {
    const items: TodoItem[] = [
      { id: '1', text: 'a', status: 'completed' },
      { id: '2', text: 'b', status: 'pending' },
      { id: '3', text: 'c', status: 'in_progress' }
    ]
    expect(items.map((_, i) => todoRowState(items, i))).toEqual(['done', 'pending', 'current'])
    const pending: TodoItem[] = [
      { id: '1', text: 'a', status: 'completed' },
      { id: '2', text: 'b', status: 'pending' },
      { id: '3', text: 'c', status: 'pending' }
    ]
    expect(pending.map((_, i) => todoRowState(pending, i))).toEqual(['done', 'current', 'pending'])
  })
})

describe('sameTodos', () => {
  it('compares item by item', () => {
    const items = runTasks()
    expect(sameTodos(items, runTasks())).toBe(true)
    expect(sameTodos(items, items.slice(1))).toBe(false)
    expect(sameTodos(items, [{ ...items[0]!, status: 'pending' }, ...items.slice(1)])).toBe(false)
  })
})
