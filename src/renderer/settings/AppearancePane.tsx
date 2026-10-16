import { useMemo } from 'react'
import { LIMITS, type AppearanceSettings } from '@shared/settings'
import { Row, Section, Select, Slider, ThemeSwatches, Toggle, type SelectOption } from './controls'
import { THEME_OPTIONS, displayFamily, fontSizeOptions, formatLineHeight, formatPercent, previewCaption } from './appearance-form'
import { CJK_SAMPLE, LATIN_SAMPLE, cssFamily, withCurrent } from './fonts'
import { useFontCatalog } from './local-fonts'
import { PreviewTerminal } from './PreviewTerminal'
import styles from './AppearancePane.module.css'

const THEME_SWATCHES = THEME_OPTIONS.map((option) => ({ ...option, kind: option.value }))

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
  const cjkOptions = useMemo(() => withCurrent(catalog.cjk, appearance.cjkFont).map(cjkOption), [catalog.cjk, appearance.cjkFont])
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
          <Row label="侧栏毛玻璃" id="sidebarVibrancy">
            <Toggle label="侧栏毛玻璃" checked={appearance.sidebarVibrancy} onChange={(sidebarVibrancy) => update({ sidebarVibrancy })} />
          </Row>
        </Section>
      </div>

      <div className={styles.previewColumn}>
        <h2 className={styles.previewTitle}>预览</h2>
        <PreviewTerminal appearance={appearance} />
        <p className={styles.caption} data-testid="preview-caption">
          {previewCaption(appearance)}
        </p>
      </div>
    </div>
  )
}
