import { useEffect, useRef } from 'react'
import { decideDigitKey, type FocusKind } from './keys'

/** Composer textarea (Composer.tsx labels it "输入框"); the bar needs to know whether it holds text. */
const COMPOSER = 'textarea[aria-label="输入框"]'
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

export function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>(COMPOSER)?.focus()
}

function classifyFocus(target: EventTarget | null): FocusKind {
  if (!(target instanceof Element)) return { type: 'elsewhere' }
  if (target.closest('[data-prompt-input]')) return { type: 'bar-input' }
  if (target.matches(COMPOSER)) return { type: 'composer', empty: (target as HTMLTextAreaElement).value === '' }
  // xterm's hidden helper textarea is the terminal itself, not a text field.
  if (target.closest('.xterm')) return { type: 'elsewhere' }
  if (target.matches(EDITABLE)) return { type: 'other-input' }
  return { type: 'elsewhere' }
}

/**
 * Window-level 1–9 / ⌥1–9 while a prompt is on screen. `onDigit` returns true when it used the key
 * (then the key never reaches the composer or the terminal).
 */
export function useDigitKeys(onDigit: (n: number) => boolean): void {
  const handler = useRef(onDigit)
  useEffect(() => {
    handler.current = onDigit
  })
  useEffect(() => {
    // Capture phase: runs before the composer's own keydown handler and before xterm sees the key.
    const onKeyDown = (e: KeyboardEvent) => {
      const n = decideDigitKey(
        {
          code: e.code,
          key: e.key,
          keyCode: e.keyCode,
          isComposing: e.isComposing,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey
        },
        classifyFocus(e.target)
      )
      if (n === null || !handler.current(n)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
