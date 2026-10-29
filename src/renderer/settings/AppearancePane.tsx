import { useMemo, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, FULLSCREEN_BACKDROPS, LIMITS, type AppearanceSettings, type FullscreenBackdrop } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { hasCustomBackground } from '../appearance/map'
import { buildCustomTheme } from '../terminal/appearance'
import { HexField, Row, Section, Select, Slider, ThemeSwatches, Toggle, type SelectOption } from './controls'
import { BACKGROUND_OPTIONS, THEME_OPTIONS, displayFamily, fontSizeOptions, formatLineHeight, formatPercent, previewCaption, sameAppearanceValue } from './appearance-form'
import { CJK_SAMPLE, LATIN_SAMPLE, cssFamily, groupCjkFamilies, withCurrent } from './fonts'
import { useFontCatalog } from './local-fonts'
import { PreviewTerminal } from './PreviewTerminal'
import { useThemeBackground } from './useThemeBackground'
import styles from './AppearancePane.module.css'

const THEME_SWATCHES = THEME_OPTIONS.map((option) => ({ ...option, kind: option.value }))

/** What 恢复默认 resets: everything on this page except the theme and 全屏背景, which have their own one-click choices. */
const APPEARANCE_RESET_KEYS = (Object.keys(DEFAULT_SETTINGS.appearance) as (keyof AppearanceSettings)[]).filter(
  (key) => key !== 'theme' && key !== 'fullscreenBackdrop'
)

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

function appearanceDefaults(): Partial<AppearanceSettings> {
  return Object.fromEntries(APPEARANCE_RESET_KEYS.map((key) => [key, DEFAULT_SETTINGS.appearance[key]]))
}

function latinOption(family: string): SelectOption {
  const face = { fontFamily: cssFamily(family, 'monospace') }
  return { value: family, label: displayFamily(family), labelStyle: face, sample: LATIN_SAMPLE, sampleStyle: face }
}

function cjkOption(family: string): SelectOption {
  // PingFang SC stays in the stack so a missing glyph never falls back to a Japanese face.
  const face = { fontFamily: cssFamily(family, '"PingFang SC", sans-serif') }
  return { value: family, label: displayFamily(family), labelStyle: face, sample: CJK_SAMPLE, sampleStyle: face }
}

export function AppearancePane({
  appearance,
  update
}: {
  appearance: AppearanceSettings
  update: (patch: Partial<AppearanceSettings>) => void
}) {
  const { catalog, access } = useFontCatalog()
  const latinOptions = useMemo(() => withCurrent(catalog.latin, appearance.latinFont).map(latinOption), [catalog.latin, appearance.latinFont])
  const cjkOptions = useMemo(
    () => groupCjkFamilies(withCurrent(catalog.cjk, appearance.cjkFont)).map(({ family, group }) => ({ ...cjkOption(family), group })),
    [catalog.cjk, appearance.cjkFont]
  )
  const isDefault = APPEARANCE_RESET_KEYS.every((key) => sameAppearanceValue(appearance[key], DEFAULT_SETTINGS.appearance[key]))
  const themeBackground = useThemeBackground()
  const background = appearance.terminalBackground
  const custom = hasCustomBackground(appearance)
  // The preview terminal gets the colors the session terminals get.
  const customTheme = useMemo(
    () => (custom ? buildCustomTheme(background.color, appearance.terminalColors) : undefined),
    [custom, background.color, appearance.terminalColors]
  )
  const sizeOptions = useMemo<SelectOption[]>(
    () => fontSizeOptions(appearance.fontSize).map((size) => ({ value: String(size), label: String(size) })),
    [appearance.fontSize]
  )

  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>外观</h1>

        <Section title="主题">
          <ThemeSwatches
            label="主题"
            value={appearance.theme}
            options={THEME_SWATCHES}
            onChange={(theme) => update({ theme })}
          />
          <button type="button" className={styles.importButton} onClick={() => void window.tr.settings.importTheme()}>
            导入主题…
          </button>
        </Section>

        <Section title="全屏背景">
          <ThemeSwatches
            label="全屏背景"
            value={appearance.fullscreenBackdrop}
            options={BACKDROP_OPTIONS}
            onChange={(fullscreenBackdrop) => update({ fullscreenBackdrop })}
          />
        </Section>

        <Section title="字体">
          <Row label="英文字体" id="latinFont">
            <Select
              label="英文字体"
              value={appearance.latinFont}
              options={latinOptions}
              allowCustom
              placeholder="搜索或输入字体名"
              onChange={(latinFont) => update({ latinFont })}
            />
          </Row>
          <Row label="中文字体" id="cjkFont">
            <Select
              label="中文字体"
              value={appearance.cjkFont}
              options={cjkOptions}
              allowCustom
              placeholder="搜索或输入字体名"
              onChange={(cjkFont) => update({ cjkFont })}
            />
          </Row>
          <Row label="字号" id="fontSize">
            <Select
              label="字号"
              value={String(appearance.fontSize)}
              options={sizeOptions}
              onChange={(size) => update({ fontSize: Number(size) })}
            />
          </Row>
          <Row label="行高" id="lineHeight">
            <Slider
              label="行高"
              value={appearance.lineHeight}
              min={LIMITS.lineHeight.min}
              max={LIMITS.lineHeight.max}
              step={0.05}
              format={formatLineHeight}
              onCommit={(lineHeight) => update({ lineHeight })}
            />
          </Row>
          <Row label="连字" id="ligatures">
            <Toggle label="连字" checked={appearance.ligatures} onChange={(ligatures) => update({ ligatures })} />
          </Row>
          {(access === 'denied' || access === 'unsupported') && (
            <p className={styles.hint}>无法读取已安装的字体列表。可以直接在字体菜单中输入字体名称。</p>
          )}
        </Section>

        <Section title="窗口">
          <Row label="终端底色" id="terminalBackground">
            <Segmented
              label="终端底色"
              value={background.mode}
              options={BACKGROUND_OPTIONS}
              onChange={(mode) => update({ terminalBackground: { ...background, mode } })}
            />
          </Row>
          <Row label="底色值" id="terminalBackgroundColor">
            <HexField
              label="底色值"
              value={custom ? background.color : themeBackground}
              disabled={!custom}
              onCommit={(color) => update({ terminalBackground: { mode: 'custom', color } })}
            />
          </Row>
          <Row label="终端不透明度" id="terminalOpacity">
            <Slider
              label="终端不透明度"
              value={appearance.terminalOpacity}
              min={LIMITS.terminalOpacity.min}
              max={LIMITS.terminalOpacity.max}
              step={0.01}
              format={formatPercent}
              onCommit={(terminalOpacity) => update({ terminalOpacity })}
            />
          </Row>
        </Section>

        <Section title="辅助功能">
          <Row label="读屏模式" id="screenReader">
            <Toggle label="读屏模式" checked={appearance.screenReader} onChange={(screenReader) => update({ screenReader })} />
          </Row>
          <p className={styles.hint}>让 VoiceOver 朗读终端输出。会稍微增加渲染开销。</p>
        </Section>

        <div className={styles.footer}>
          <button type="button" className={styles.reset} disabled={isDefault} onClick={() => update(appearanceDefaults())}>
            恢复默认
          </button>
          <span className={styles.footerHint}>字体、字号、行高、连字、窗口和辅助功能回到默认值；主题不变。</span>
        </div>
      </div>

      <div className={styles.previewColumn}>
        <h2 className={styles.previewTitle}>预览</h2>
        <PreviewTerminal appearance={{ ...appearance, customTheme }} />
        <p className={styles.caption} data-testid="preview-caption">
          {previewCaption(appearance)}
        </p>
      </div>
    </div>
  )
}
