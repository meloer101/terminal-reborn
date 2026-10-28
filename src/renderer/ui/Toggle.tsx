// A switch (Figma Toggle 12:136, square corners per 31-G1): 28 × 16, the knob slides right and the track fills when on. The same look as
// 设置's Toggle; this one is for panels outside the settings dialog (Git · 变更's PR switches, PRD F16 v1.63).
import styles from './Toggle.module.css'

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  title
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  )
}
