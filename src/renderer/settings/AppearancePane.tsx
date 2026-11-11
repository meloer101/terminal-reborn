// 设置 · 外观 (Figma 66A / 66B): what the whole window looks like — theme, material, 全屏背景. The terminal's and the
// chat's own settings are on 终端 and 对话.
import type { ReactNode } from 'react'
import { FULLSCREEN_BACKDROPS, LIMITS, type AppearancePatch, type AppearanceSettings, type FullscreenBackdrop } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { PreviewPage, Row, Section, Slider, ThemeSwatches } from './controls'
import { MATERIAL_OPTIONS, THEME_OPTIONS, formatPercent, isPageDefault, pageDefaults } from './appearance-form'
import styles from './AppearancePane.module.css'

const THEME_SWATCHES = THEME_OPTIONS.map((option) => ({ ...option, kind: option.value }))

/** 全屏背景 (Figma 38): the author's 配图底托, named for what they look like; 自动 is 晴空 in light mode, 夜火 in dark. */
const BACKDROP_NAMES: Record<(typeof FULLSCREEN_BACKDROPS)[number], string> = {
  sky: '晴空',
  meadow: '青原',
  lake: '湖岸',
  dune: '沙丘',
  pine: '松林',
  dusk: '暮紫',
  coral: '珊瑚',
  sunset: '晚霞',
  ember: '夜火',
  plum: '霞紫'
}
const field = (id: string) => <span className={styles.backdropField} style={{ background: `var(--fsb-${id})` }} />
const BACKDROP_OPTIONS: ReadonlyArray<{ value: FullscreenBackdrop; label: string; preview: ReactNode }> = [
  {
    value: 'auto',
    label: '自动',
    preview: (
      <>
        {field('sky')}
        <span className={styles.backdropHalf}>{field('ember')}</span>
      </>
    )
  },
  ...FULLSCREEN_BACKDROPS.map((id) => ({ value: id, label: BACKDROP_NAMES[id], preview: field(id) }))
]

/**
 * A small window over a desktop field, drawn with the variables the app applies on <html> (appearance/map.ts): the
 * sidebar is the shell over the base layer, the cards are the terminal and the chat at their opacities.
 */
function WindowPreview() {
  return (
    <div className={styles.windowPreview} data-testid="window-preview" aria-hidden>
      <div className={styles.miniWindow}>
        <div className={styles.miniSidebar}>
          <span />
          <span />
          <span />
        </div>
        <div className={`${styles.miniCard} ${styles.miniTerminal}`}>
          <span />
          <span />
        </div>
        <div className={`${styles.miniCard} ${styles.miniChat}`}>
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}

export function AppearancePane({ appearance, update }: { appearance: AppearanceSettings; update: (patch: AppearancePatch) => void }) {
  const solid = appearance.windowMaterial === 'solid'
  return (
    <PreviewPage
      title="外观"
      preview={<WindowPreview />}
      isDefault={isPageDefault(appearance, 'appearance')}
      onReset={() => update(pageDefaults('appearance'))}
    >
      <Section title="主题">
        <ThemeSwatches label="主题" value={appearance.theme} options={THEME_SWATCHES} onChange={(theme) => update({ theme })} />
      </Section>

      <Section title="窗口">
        <Row label="材质" id="windowMaterial">
          <Segmented label="材质" value={appearance.windowMaterial} options={MATERIAL_OPTIONS} onChange={(windowMaterial) => update({ windowMaterial })} />
        </Row>
        {/* 实色 (Figma 57C) has no base layer to show through. */}
        {!solid && (
          <Row label="窗口底层不透明度" id="shellOpacity">
            <Slider
              label="窗口底层不透明度"
              value={appearance.shellOpacity}
              min={LIMITS.shellOpacity.min}
              max={LIMITS.shellOpacity.max}
              step={0.01}
              format={formatPercent}
              onCommit={(shellOpacity) => update({ shellOpacity })}
            />
          </Row>
        )}
      </Section>

      {/* 实色 (Figma 57C) draws no field in full screen, so there is nothing to choose. */}
      {!solid && (
        <Section title="全屏背景">
          <ThemeSwatches
            label="全屏背景"
            value={appearance.fullscreenBackdrop}
            options={BACKDROP_OPTIONS}
            onChange={(fullscreenBackdrop) => update({ fullscreenBackdrop })}
          />
        </Section>
      )}
    </PreviewPage>
  )
}
