// 设置 · 外观 · 对话's preview (Figma 51D): one exchange drawn with the --chat-* variables the app applies on <html>
// (appearance/map.ts), so it shows exactly what GUI sessions get — column aside — the user's picture included.
import { AgentIcon } from '../ui/AgentIcon'
import styles from './AppearancePane.module.css'

export function ChatPreview() {
  return (
    <div className={styles.chatPreview} data-testid="chat-preview">
      <div className={styles.chatUser}>
        <span className={styles.chatBubble}>把登录态迁移到 httpOnly cookie</span>
        <span className={styles.chatUserAvatar} aria-hidden />
      </div>
      <div className={styles.chatAgent}>
        <span className={styles.chatAgentAvatar} aria-hidden>
          <AgentIcon kind="claude" size={16} />
        </span>
        <span>好。先看一下 session.ts 里 token 是怎么存的，再改登录接口。中英混排 abc 123 对齐检查。</span>
      </div>
    </div>
  )
}
