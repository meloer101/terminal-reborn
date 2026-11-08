// 设置 · 对话 (Figma 66D / 66H): what GUI sessions read — my picture, the chat font, its column and card opacity.
import { useMemo, useRef } from 'react'
import { LIMITS, type AppearancePatch, type AppearanceSettings, type ChatAppearance, type ChatWeight } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { PreviewPage, Row, Section, Select, Slider } from './controls'
import {
  CHAT_SIZE_OPTIONS,
  CHAT_WEIGHT_OPTIONS,
  CHAT_WIDTH_OPTIONS,
  chatPreviewCaption,
  cjkOptions,
  formatPercent,
  isPageDefault,
  pageDefaults,
  uiOption
} from './appearance-form'
import { avatarFromFile } from './avatar'
import { ChatPreview } from './ChatPreview'
import { withCurrent } from './fonts'
import { useFontCatalog } from './local-fonts'
import styles from './AppearancePane.module.css'

export function ChatPane({ appearance, update }: { appearance: AppearanceSettings; update: (patch: AppearancePatch) => void }) {
  const { catalog } = useFontCatalog()
  const chat = appearance.chat
  const updateChat = (patch: Partial<ChatAppearance>): void => update({ chat: patch })
  const uiOptions = useMemo(() => ['', ...withCurrent(catalog.ui, chat.latinFont).filter((f) => f !== '')].map(uiOption), [catalog.ui, chat.latinFont])
  const cjk = useMemo(() => cjkOptions(catalog.cjk, chat.cjkFont), [catalog.cjk, chat.cjkFont])
  const picker = useRef<HTMLInputElement>(null)

  return (
    <PreviewPage
      title="对话"
      preview={<ChatPreview />}
      caption={chatPreviewCaption(chat)}
      isDefault={isPageDefault(appearance, 'chat')}
      onReset={() => update(pageDefaults('chat'))}
    >
      <Section title="头像">
        <Row label="我的头像" id="chatAvatar">
          <div className={styles.avatarControl}>
            {chat.avatar && <img className={styles.avatar} src={chat.avatar} alt="我的头像" />}
            <button type="button" className={styles.smallButton} onClick={() => picker.current?.click()}>
              {chat.avatar ? '更换…' : '选择图片…'}
            </button>
            {chat.avatar && (
              <button type="button" className={styles.smallButton} onClick={() => updateChat({ avatar: '' })}>
                移除
              </button>
            )}
          </div>
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
      </Section>

      <Section title="字体">
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
            options={cjk}
            allowCustom
            placeholder="搜索或输入字体名"
            onChange={(cjkFont) => updateChat({ cjkFont })}
          />
        </Row>
        <Row label="字重" id="chatWeight">
          <Segmented label="字重" value={`${chat.fontWeight}`} options={CHAT_WEIGHT_OPTIONS} onChange={(weight) => updateChat({ fontWeight: Number(weight) as ChatWeight })} />
        </Row>
        <Row label="字号" id="chatFontSize">
          <Select label="对话字号" value={String(chat.fontSize)} options={CHAT_SIZE_OPTIONS} onChange={(size) => updateChat({ fontSize: Number(size) })} />
        </Row>
      </Section>

      <Section title="版面">
        <Row label="对话宽度" id="chatWidth">
          <Segmented label="对话宽度" value={chat.width} options={CHAT_WIDTH_OPTIONS} onChange={(width) => updateChat({ width })} />
        </Row>
        {/* 实色 makes every card opaque (Figma 66B), so the opacity has nothing to change there. */}
        {appearance.windowMaterial !== 'solid' && (
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
        )}
      </Section>
    </PreviewPage>
  )
}
