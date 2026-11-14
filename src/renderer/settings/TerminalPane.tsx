// 设置 · 终端 (Figma 66C / 66G): everything the CLI sessions' terminal reads — colors, font, screen reader.
import { useMemo } from 'react'
import { LIMITS, type AppearancePatch, type AppearanceSettings } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { hasCustomBackground } from '../appearance/map'
import { buildCustomTheme } from '../terminal/appearance'
import { HexField, PreviewPage, Row, Section, Select, Slider, Toggle, type SelectOption } from './controls'
import {
  BACKGROUND_OPTIONS,
  cjkOptions,
  fontSizeOptions,
  formatLineHeight,
  formatPercent,
  isPageDefault,
  latinOption,
  pageDefaults,
  previewCaption
} from './appearance-form'
import { withCurrent } from './fonts'
import { useFontCatalog } from './local-fonts'
import { PreviewTerminal } from './PreviewTerminal'
import { useThemeBackground } from './useThemeBackground'
import styles from './AppearancePane.module.css'

export function TerminalPane({ appearance, update }: { appearance: AppearanceSettings; update: (patch: AppearancePatch) => void }) {
  const { catalog, access } = useFontCatalog()
  const latinOptions = useMemo(() => withCurrent(catalog.latin, appearance.latinFont).map(latinOption), [catalog.latin, appearance.latinFont])
  const cjk = useMemo(() => cjkOptions(catalog.cjk, appearance.cjkFont), [catalog.cjk, appearance.cjkFont])
  const sizeOptions = useMemo<SelectOption[]>(
    () => fontSizeOptions(appearance.fontSize).map((size) => ({ value: String(size), label: String(size) })),
    [appearance.fontSize]
  )
  const themeBackground = useThemeBackground()
  const background = appearance.terminalBackground
  const custom = hasCustomBackground(appearance)
  // The preview terminal gets the colors the session terminals get.
  const customTheme = useMemo(
    () => (custom ? buildCustomTheme(background.color, appearance.terminalColors) : undefined),
    [custom, background.color, appearance.terminalColors]
  )

  return (
    <PreviewPage
      title="终端"
      preview={
        <div className={styles.previewField}>
          <PreviewTerminal appearance={{ ...appearance, customTheme }} />
        </div>
      }
      caption={previewCaption(appearance)}
      isDefault={isPageDefault(appearance, 'terminal')}
      onReset={() => update(pageDefaults('terminal'))}
    >
      <Section title="配色">
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
        {/* 实色 makes every card opaque (Figma 66B), so the opacity has nothing to change there. */}
        {appearance.windowMaterial !== 'solid' && (
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
        )}
        <button type="button" className={styles.importButton} onClick={() => void window.tr.settings.importTheme()}>
          导入主题…
        </button>
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
            options={cjk}
            allowCustom
            placeholder="搜索或输入字体名"
            onChange={(cjkFont) => update({ cjkFont })}
          />
        </Row>
        <Row label="字号" id="fontSize">
          <Select label="字号" value={String(appearance.fontSize)} options={sizeOptions} onChange={(size) => update({ fontSize: Number(size) })} />
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
        {(access === 'denied' || access === 'unsupported') && <p className={styles.hint}>无法读取已安装的字体列表。可以直接在字体菜单中输入字体名称。</p>}
      </Section>

      <Section title="辅助功能">
        <Row label="读屏模式" id="screenReader">
          <Toggle label="读屏模式" checked={appearance.screenReader} onChange={(screenReader) => update({ screenReader })} />
        </Row>
        <p className={styles.hint}>让 VoiceOver 朗读终端输出。会稍微增加渲染开销。</p>
      </Section>
    </PreviewPage>
  )
}
