import styles from './ProjectHeader.module.css'

/** Figma component `ProjectHeader` (11:52): group name left, session count right. Also titles the "等你处理" queue. */
export function ProjectHeader({ name, count }: { name: string; count: number }) {
  return (
    <div className={styles.header}>
      <h2 className={styles.name}>{name}</h2>
      <span className={styles.count}>{count}</span>
    </div>
  )
}
