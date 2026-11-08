// The agent's task list (PRD F23, Figma 59J): Claude's TodoWrite, Codex's and ACP agents' plan. The latest list sits
// in a card above the composer while something in it is left (ChatPane, `currentTodos`); in the feed its row
// 「任务 · N 项」 opens to the same list (Feed). Each task: its status glyph — done, in progress, not started — and its
// text, the one in progress in the primary colour, done ones tertiary.
import { ListTodo } from 'lucide-react'
import type { ChatTodo } from '@shared/transcript-chat'
import { StatusGlyph } from '../ui/StatusGlyph'
import { todoProgress, todoStatus } from './model'
import styles from './Chat.module.css'

export function TodoList({ todos, className }: { todos: readonly ChatTodo[]; className?: string }) {
  return (
    <ul className={className ? `${styles.todos} ${className}` : styles.todos}>
      {todos.map((todo, i) => (
        <li key={i} className={styles.todo} data-status={todo.status}>
          <StatusGlyph status={todoStatus(todo.status)} />
          <span className={styles.todoText}>{todo.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function TodoCard({ todos }: { todos: readonly ChatTodo[] }) {
  const { done, total } = todoProgress(todos)
  return (
    <section className={styles.todoCard} aria-label="任务" data-testid="gui-todos">
      <header className={styles.todoHeader}>
        <ListTodo size={16} strokeWidth={1.75} aria-hidden />
        <span>任务</span>
        <span className={styles.todoCount}>
          {done} / {total}
        </span>
      </header>
      <TodoList todos={todos} />
    </section>
  )
}
