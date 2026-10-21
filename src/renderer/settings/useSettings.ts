import { useCallback, useEffect, useState } from 'react'
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  type AlertSettings,
  type AppSettings,
  type AppearanceSettings,
  type ArchiveSettings,
  type PortSettings,
  type PrSettings,
  type ReviewSettings
} from '@shared/settings'

export interface SettingsHandle {
  settings: AppSettings
  /** True once the persisted settings have been read (before that, defaults are shown). */
  loaded: boolean
  updateAppearance(patch: Partial<AppearanceSettings>): void
  updatePorts(patch: Partial<PortSettings>): void
  updateReview(patch: Partial<ReviewSettings>): void
  updateArchive(patch: Partial<ArchiveSettings>): void
  updateAlerts(patch: Partial<AlertSettings>): void
  updatePr(patch: Partial<PrSettings>): void
}

/**
 * Live view of AppSettings for the settings window: reads once, follows every onChange, and
 * applies edits optimistically so controls never lag behind the main-process round trip.
 * The window's theme follows settings through initTheme() (main.tsx), like every window.
 */
export function useSettings(): SettingsHandle {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const accept = (next: AppSettings): void => {
      if (cancelled) return
      setSettings(next)
    }
    const unsubscribe = window.tr.settings.onChange(accept)
    void window.tr.settings.get().then((initial) => {
      accept(initial)
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setSettings((current) => applySettingsPatch(current, { appearance: patch }))
    void window.tr.settings.update({ appearance: patch })
  }, [])

  const updatePorts = useCallback((patch: Partial<PortSettings>) => {
    setSettings((current) => applySettingsPatch(current, { ports: patch }))
    void window.tr.settings.update({ ports: patch })
  }, [])

  const updateReview = useCallback((patch: Partial<ReviewSettings>) => {
    setSettings((current) => applySettingsPatch(current, { review: patch }))
    void window.tr.settings.update({ review: patch })
  }, [])

  const updateArchive = useCallback((patch: Partial<ArchiveSettings>) => {
    setSettings((current) => applySettingsPatch(current, { archive: patch }))
    void window.tr.settings.update({ archive: patch })
  }, [])

  const updateAlerts = useCallback((patch: Partial<AlertSettings>) => {
    setSettings((current) => applySettingsPatch(current, { alerts: patch }))
    void window.tr.settings.update({ alerts: patch })
  }, [])

  const updatePr = useCallback((patch: Partial<PrSettings>) => {
    setSettings((current) => applySettingsPatch(current, { pr: patch }))
    void window.tr.settings.update({ pr: patch })
  }, [])

  return { settings, loaded, updateAppearance, updatePorts, updateReview, updateArchive, updateAlerts, updatePr }
}
