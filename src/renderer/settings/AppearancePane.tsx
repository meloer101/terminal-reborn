import { useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { DEFAULT_SETTINGS, FULLSCREEN_BACKDROPS, LIMITS, type AppearancePatch, type AppearanceSettings, type ChatAppearance, type ChatWeight, type FullscreenBackdrop } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { hasCustomBackground, shownMaterial } from '../appearance/map'
import { buildCustomTheme } from '../terminal/appearance'
import { HexField, Row, Section, Select, Slider, ThemeSwatches, Toggle, type SelectOption } from './controls'
import {
  BACKGROUND_OPTIONS,
  CHAT_SIZE_OPTIONS,
  CHAT_WEIGHT_OPTIONS,
  CHAT_WIDTH_OPTIONS,
  MATERIAL_OPTIONS,
  SYSTEM_UI_FONT,
  THEME_OPTIONS,
  chatPreviewCaption,
  displayFamily,
  fontSizeOptions,
  formatLineHeight,
  formatPercent,
  previewCaption,
  sameAppearanceValue
} from './appearance-form'
import { avatarFromFile } from './avatar'
import { ChatPreview } from './ChatPreview'
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

function appearanceDefaults(): AppearancePatch {
  return Object.fromEntries(APPEARANCE_RESET_KEYS.map((key) => [key, DEFAULT_SETTINGS.appearance[key]]))
}

function latinOption(family: string): SelectOption {
  const face = { fontFamily: cssFamily(family, 'monospace') }
  return { value: family, label: displayFamily(family), labelStyle: face, sample: LATIN_SAMPLE, sampleStyle: face }
}

function uiOption(family: string): SelectOption {
  if (family === '') return { value: '', label: SYSTEM_UI_FONT, labelStyle: { fontFamily: 'var(--font-ui)' }, sample: LATIN_SAMPLE, sampleStyle: { fontFamily: 'var(--font-ui)' } }
  const face = { fontFamily: cssFamily(family, 'sans-serif') }
  return { value: family, label: displayFamily(family), labelStyle: face, sample: LATIN_SAMPLE, sampleStyle: face }
}

/** The preview shows the chat once 对话 is clicked or tabbed into, the terminal once another section is (Figma 51D). */
const previewOf = (event: SyntheticEvent): 'chat' | 'terminal' =>
  (event.target as HTMLElement).closest('section')?.getAttribute('aria-label') === '对话' ? 'chat' : 'terminal'

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
  update: (patch: AppearancePatch) => void
}) {
  const { catalog, access } = useFontCatalog()
  const chat = appearance.chat
  const updateChat = (patch: Partial<ChatAppearance>): void => update({ chat: patch })
  const uiOptions = useMemo(() => ['', ...withCurrent(catalog.ui, chat.latinFont).filter((f) => f !== '')].map(uiOption), [catalog.ui, chat.latinFont])
  const chatCjkOptions = useMemo(
    () => groupCjkFamilies(withCurrent(catalog.cjk, chat.cjkFont)).map(({ family, group }) => ({ ...cjkOption(family), group })),
    [catalog.cjk, chat.cjkFont]
  )
  const [preview, setPreview] = useState<'chat' | 'terminal'>('terminal')
  const picker = useRef<HTMLInputElement>(null)
  const material = shownMaterial(appearance, window.tr.liquidGlass)
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
      <div className={styles.form} onPointerDown={(e) => setPreview(previewOf(e))} onFocus={(e) => setPreview(previewOf(e))}>
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

        <Section title="对话">
          <Row label="我的头像" id="chatAvatar">
            {chat.avatar && <img className={styles.avatar} src={chat.avatar} alt="我的头像" />}
            <button type="button" className={styles.importButton} onClick={() => picker.current?.click()}>
              {chat.avatar ? '更换…' : '选择图片…'}
            </button>
            {chat.avatar && (
              <button type="button" className={styles.importButton} onClick={() => updateChat({ avatar: '' })}>
                移除
              </button>
            )}
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              data-testid="avatar-file"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (file) void avatarFromFile(file).then((avatar) => updateChat({ avatar }), (error: unknown) => console.warn('[settings] could not read the picture:', error))
              }}
            />
          </Row>
          <Row label="对话宽度" id="chatWidth">
            <Segmented label="对话宽度" value={chat.width} options={CHAT_WIDTH_OPTIONS} onChange={(width) => updateChat({ width })} />
          </Row>
          <Row label="英文字体" id="chatLatinFont">
            <Select
              label="对话英文字体"
              value={chat.latinFont}
              options={uiOptions}
              allowCustom
              placeholder="搜索或输入字体名"
              onChange={(latinFont) => updateChat({ latinFont })}
            />
          </Row>
          <Row label="中文字体" id="chatCjkFont">
            <Select
              label="对话中文字体"
              value={chat.cjkFont}
              options={chatCjkOptions}
              allowCustom
              placeholder="搜索或输入字体名"
              onChange={(cjkFont) => updateChat({ cjkFont })}
            />
          </Row>
          <Row label="字重" id="chatWeight">
            <Segmented
              label="字重"
              value={`${chat.fontWeight}`}
              options={CHAT_WEIGHT_OPTIONS}
              onChange={(weight) => updateChat({ fontWeight: Number(weight) as ChatWeight })}
            />
          </Row>
          <Row label="字号" id="chatFontSize">
            <Select label="对话字号" value={String(chat.fontSize)} options={CHAT_SIZE_OPTIONS} onChange={(size) => updateChat({ fontSize: Number(size) })} />
          </Row>
        </Section>

        <Section title="窗口">
          {window.tr.liquidGlass && (
            <Row label="材质" id="windowMaterial">
              <Segmented label="材质" value={appearance.windowMaterial} options={MATERIAL_OPTIONS} onChange={(windowMaterial) => update({ windowMaterial })} />
            </Row>
          )}
          <Row label="窗口底层不透明度" id="shellOpacity">
            <Slider
              label="窗口底层不透明度"
              value={appearance.shellOpacity[material]}
              min={LIMITS.shellOpacity.min}
              max={LIMITS.shellOpacity.max}
              step={0.01}
              format={formatPercent}
              onCommit={(value) => update({ shellOpacity: { [material]: value } })}
            />
          </Row>
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
          <Row label="对话不透明度" id="chatOpacity">
            <Slider
              label="对话不透明度"
              value={chat.opacity}
              min={LIMITS.chatOpacity.min}
              max={LIMITS.chatOpacity.max}
              step={0.01}
              format={formatPercent}
              onCommit={(opacity) => updateChat({ opacity })}
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
          <span className={styles.footerHint}>字体、字号、行高、连字、对话、窗口和辅助功能回到默认值；主题不变。</span>
        </div>
      </div>

      <div className={styles.previewColumn}>
        <h2 className={styles.previewTitle}>预览</h2>
        {preview === 'chat' ? <ChatPreview /> : <PreviewTerminal appearance={{ ...appearance, customTheme }} />}
        <p className={styles.caption} data-testid="preview-caption">
          {preview === 'chat' ? chatPreviewCaption(chat) : previewCaption(appearance)}
        </p>
      </div>
    </div>
  )
}
