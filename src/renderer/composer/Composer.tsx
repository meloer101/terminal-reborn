// PLACEHOLDER — owned by the `composer` track (docs/tasks/m1-composer.md).
import styles from './Composer.module.css'

export function Composer() {
  return (
    <div className={styles.composer}>
      <textarea className={styles.input} rows={1} placeholder="输入任务或回复，↵ 发送，⇧↵ 换行" />
    </div>
  )
}
