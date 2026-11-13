// iOS 模拟器 view (PRD F17, Figma 76C / 76D): one simulator, drawn and driven through main (serve-sim). Global, not per
// worktree. States: 需要 Xcode · 选择设备 (simulators by runtime) · 正在启动 · the screen, with the Device Hub row when
// Xcode 27 holds the device's input. Frames flow only while this view is shown and the window is visible.
import { ChevronDown, Circle, CircleAlert, RotateCw, Smartphone } from 'lucide-react'
import { useEffect, useState, type MouseEvent } from 'react'
import { findDevice, initialDevice, type SimRuntimeGroup, type SimulatorScreen as Screen } from '@shared/simulator'
import { IconButton } from '../../ui/IconButton'
import { popupMenu, type MenuEntry } from '../../ui/menu'
import { ClosePanelButton } from '../PaneHeader'
import { SimulatorScreen } from './SimulatorScreen'
import panel from '../RightPanel.module.css'
import styles from './SimulatorView.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

type Listing = { kind: 'loading' } | { kind: 'no-xcode' } | { kind: 'devices'; runtimes: SimRuntimeGroup[] }

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

export function SimulatorView() {
  const [listing, setListing] = useState<Listing>({ kind: 'loading' })
  const [chosen, setChosen] = useState<string | null>(null)
  /** Bumped by 重新连接: shows the device again. */
  const [attempt, setAttempt] = useState(0)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [repairing, setRepairing] = useState(false)
  const visible = useVisible()

  useEffect(() => {
    let cancelled = false
    void window.tr.simulator
      .list()
      .then((result) => {
        if (cancelled) return
        if (result.kind === 'no-xcode') return setListing({ kind: 'no-xcode' })
        setListing({ kind: 'devices', runtimes: result.runtimes })
        setChosen(initialDevice(result.runtimes, result.lastUdid)?.udid ?? null)
      })
      // simctl failed (main logged why): an empty list, and the picker reads it again when opened.
      .catch(() => !cancelled && setListing({ kind: 'devices', runtimes: [] }))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => window.tr.simulator.onScreen(setScreen), [])

  useEffect(() => {
    if (!chosen || !visible) return
    window.tr.simulator.show(chosen)
    return () => window.tr.simulator.hide()
  }, [chosen, visible, attempt])

  /** Re-reads the list (a device may have booted or been added since) before the picker opens. */
  const refresh = async (): Promise<SimRuntimeGroup[]> => {
    const result = await window.tr.simulator.list().catch(() => null)
    if (!result) return listing.kind === 'devices' ? listing.runtimes : []
    if (result.kind === 'no-xcode') {
      setListing({ kind: 'no-xcode' })
      return []
    }
    setListing({ kind: 'devices', runtimes: result.runtimes })
    return result.runtimes
  }

  const choose = (udid: string) => {
    setScreen(null)
    setChosen(udid)
    setAttempt((n) => n + 1)
  }

  const openPicker = async (event: MouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget
    const runtimes = await refresh()
    const entries: MenuEntry[] = runtimes.flatMap((group): MenuEntry[] => [
      { type: 'header', label: group.runtime },
      ...group.devices.map((d): MenuEntry => ({ type: 'item', id: d.udid, label: d.name, checked: d.udid === chosen }))
    ])
    if (entries.length === 0) return
    const id = await popupMenu(entries, anchor)
    if (id && id !== chosen) choose(id)
  }

  const runtimes = listing.kind === 'devices' ? listing.runtimes : []
  const device = findDevice(runtimes, chosen)
  const current = screen && screen.udid === chosen ? screen : null
  const live = current?.phase === 'live'

  const repair = async () => {
    setRepairing(true)
    try {
      await window.tr.simulator.repairInput()
    } finally {
      setRepairing(false)
    }
  }

  return (
    <>
      <div className={panel.header}>
        <h2 className={panel.title}>iOS 模拟器</h2>
        <span className={styles.context}>
          {listing.kind === 'devices' && (
            <button
              type="button"
              className={styles.picker}
              data-empty={!device}
              aria-haspopup="menu"
              onClick={(e) => void openPicker(e)}
              data-testid="simulator-picker"
            >
              <span className={styles.pickerLabel}>{device ? `${device.name} · ${device.runtime}` : '选择设备'}</span>
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </span>
        <span className={panel.actions}>
          {device && (
            <>
              <IconButton label="主屏幕" disabled={!live} onClick={() => window.tr.simulator.home()}>
                <Circle {...ICON} />
              </IconButton>
              <IconButton label="旋转" disabled={!live} onClick={() => window.tr.simulator.rotate()}>
                <RotateCw {...ICON} />
              </IconButton>
            </>
          )}
          <ClosePanelButton />
        </span>
      </div>
      {current?.inputBlocked && (
        <div className={styles.notice} role="alert">
          <CircleAlert {...ICON} aria-hidden />
          <span className={styles.noticeText}>Device Hub 占用了点按和键盘</span>
          <button type="button" className={styles.secondary} disabled={repairing} onClick={() => void repair()}>
            修复输入
          </button>
        </div>
      )}
      {listing.kind === 'no-xcode' ? (
        <div className={styles.center} data-testid="simulator-no-xcode">
          <p className={styles.centerTitle}>需要 Xcode</p>
          <button type="button" className={styles.secondary} onClick={() => window.tr.simulator.openXcodeInAppStore()}>
            在 App Store 中打开
          </button>
        </div>
      ) : listing.kind === 'loading' ? null : !device ? (
        <DeviceList runtimes={runtimes} onChoose={choose} />
      ) : (
        <SimulatorScreen
          key={device.udid}
          orientation={current?.orientation ?? 'portrait'}
          live={live}
          label={`${device.name} 屏幕`}
          placeholder={
            current?.phase === 'failed' ? (
              <>
                <span>{current.error}</span>
                <button type="button" className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
                  重新连接
                </button>
              </>
            ) : current?.phase === 'booting' ? (
              '正在启动'
            ) : null
          }
        />
      )}
    </>
  )
}

/** 选择设备 (Figma 76D): simulators grouped by runtime, 28-high rows, 启动 on hover. */
function DeviceList({ runtimes, onChoose }: { runtimes: SimRuntimeGroup[]; onChoose: (udid: string) => void }) {
  if (runtimes.length === 0) return <p className={styles.empty}>没有可用的 iOS 模拟器</p>
  return (
    <div className={styles.list} data-testid="simulator-devices">
      {runtimes.map((group) => (
        <section key={group.runtime} aria-label={group.runtime}>
          <h3 className={styles.runtime}>{group.runtime}</h3>
          {group.devices.map((d) => (
            <div key={d.udid} className={styles.row} onClick={() => onChoose(d.udid)}>
              <Smartphone {...ICON} aria-hidden />
              <span className={styles.name}>{d.name}</span>
              <button
                type="button"
                className={styles.ghost}
                onClick={(e) => {
                  e.stopPropagation()
                  onChoose(d.udid)
                }}
              >
                {d.state === 'booted' ? '打开' : '启动'}
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
