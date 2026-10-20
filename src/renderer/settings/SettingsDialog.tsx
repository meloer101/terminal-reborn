// Settings as a dialog over the main window (Figma 07 · 设置 · 外观, presented as a sheet).
// Open with ⌘, (app menu → main → onShowSettings), the sidebar's 设置, or openSettings().
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { create } from 'zustand'
import { SettingsApp } from './SettingsApp'
import styles from './SettingsDialog.module.css'

const useDialog = create<{ open: boolean }>()(() => ({ open: false }))

let restoreFocus: HTMLElement | null = null

export function openSettings(): void {
  if (useDialog.getState().open) return
  const active = document.activeElement
  restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null
  useDialog.setState({ open: true })
}

export function closeSettings(): void {
  if (!useDialog.getState().open) return
  useDialog.setState({ open: false })
  const target = restoreFocus
  restoreFocus = null
  // After React removes the dialog, so the key that closed it doesn't land in the restored element.
  requestAnimationFrame(() => target?.focus())
}

export function SettingsDialog() {
  const open = useDialog((s) => s.open)
  const sheetRef = useRef<HTMLDivElement>(null)

  // ⌘, from the app menu arrives as an IPC message.
  useEffect(() => window.tr.ui.onShowSettings(openSettings), [])

  useEffect(() => {
    if (open) sheetRef.current?.focus()
  }, [open])

  if (!open) return null

  const onKeyDown = (event: KeyboardEvent) => {
    // Menus inside the sheet handle (and stop) their own Esc first; Esc while an input method composes cancels that.
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
      event.preventDefault()
      closeSettings()
    }
  }
  const onScrimMouseDown = (event: MouseEvent) => {
    if (event.target === event.currentTarget) closeSettings()
  }

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="settings">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <SettingsApp onClose={closeSettings} />
      </div>
    </div>
  )
}
