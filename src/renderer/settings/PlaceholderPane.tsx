import styles from './panes.module.css'

export function PlaceholderPane({ title }: { title: string }) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.quiet}>即将推出</p>
    </div>
  )
}
