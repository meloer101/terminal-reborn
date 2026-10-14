// The settings window (Figma 07 · 设置 · 外观). main.tsx renders this when location.hash === '#settings'.
import { useRef, useState, type KeyboardEvent } from 'react'
import { Bot, Info, Keyboard, SlidersHorizontal, Terminal, Type, type LucideIcon } from 'lucide-react'
import { AboutPane } from './AboutPane'
import { AppearancePane } from './AppearancePane'
import { PlaceholderPane } from './PlaceholderPane'
import { useSettings } from './useSettings'
import styles from './SettingsApp.module.css'

type PaneId = 'appearance' | 'general' | 'terminal' | 'agent' | 'shortcuts' | 'about'

const NAV: ReadonlyArray<{ id: PaneId; label: string; Icon: LucideIcon }> = [
  { id: 'appearance', label: '外观', Icon: Type },
  { id: 'general', label: '通用', Icon: SlidersHorizontal },
  { id: 'terminal', label: '终端', Icon: Terminal },
  { id: 'agent', label: 'Agent', Icon: Bot },
  { id: 'shortcuts', label: '快捷键', Icon: Keyboard },
  { id: 'about', label: '关于', Icon: Info }
]

export function SettingsApp() {
  const { settings, loaded, updateAppearance } = useSettings()
  const [pane, setPane] = useState<PaneId>('appearance')
  const items = useRef(new Map<PaneId, HTMLButtonElement>())

  const onNavKeyDown = (event: KeyboardEvent): void => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = NAV.findIndex((item) => item.id === pane)
    const next = NAV[(index + delta + NAV.length) % NAV.length]
    if (!next) return
    setPane(next.id)
    items.current.get(next.id)?.focus()
  }

  const active = NAV.find((item) => item.id === pane)

  return (
    <div className={styles.window}>
      <nav className={styles.nav} aria-label="设置">
        <div className={styles.titlebar} />
        <div className={styles.items} role="tablist" aria-orientation="vertical" onKeyDown={onNavKeyDown}>
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              ref={(node) => {
                if (node) items.current.set(id, node)
                else items.current.delete(id)
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={pane === id}
              aria-controls="settings-pane"
              tabIndex={pane === id ? 0 : -1}
              className={styles.item}
              onClick={() => setPane(id)}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className={styles.content} id="settings-pane" role="tabpanel" aria-labelledby={`tab-${pane}`} data-loaded={loaded}>
        <div className={styles.dragStrip} />
        {pane === 'appearance' && loaded && <AppearancePane appearance={settings.appearance} update={updateAppearance} />}
        {pane === 'about' && <AboutPane />}
        {pane !== 'appearance' && pane !== 'about' && active && <PlaceholderPane title={active.label} />}
      </main>
    </div>
  )
}
