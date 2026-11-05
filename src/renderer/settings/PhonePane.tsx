// 设置 · 手机 (PRD F22, Figma 45K): 允许手机连接, the pairing QR code and code while it is on, the addresses a phone
// reaches this Mac at, and the paired phones (撤销 forgets one). The page asks main for the status when it opens,
// which is what makes a pairing code: nothing can pair while the page is closed.
import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { formatPairingCode, type RemoteStatus } from '@shared/remote'
import type { RemoteSettings } from '@shared/settings'
import { StatusGlyph } from '../ui/StatusGlyph'
import { Row, Section, Toggle } from './controls'
import { expiresText, lastSeenText, qrPath } from './phone-model'
import styles from './PhonePane.module.css'

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function Qr({ link }: { link: string }) {
  const { size, d } = qrPath(link)
  return (
    <div className={styles.qrTile}>
      <svg className={styles.qr} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="配对二维码">
        <path d={d} />
      </svg>
    </div>
  )
}

export function PhonePane({ remote, update }: { remote: RemoteSettings; update: (patch: Partial<RemoteSettings>) => void }) {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  useEffect(() => {
    let alive = true
    const ask = () => void window.tr.remote.status().then((s) => alive && setStatus(s))
    ask()
    const off = window.tr.remote.onStatus((s) => {
      // A status push carries no code unless one is being shown; ask again so the page keeps one (none while locked).
      if (s.listening && !s.pairing && !s.pairingLocked) ask()
      else setStatus(s)
    })
    return () => {
      alive = false
      off()
      window.tr.remote.closePairing()
    }
  }, [])
  const pairing = status?.listening ? status.pairing : null
  const now = useNow(pairing !== null || (status?.devices.length ?? 0) > 0)
  const left = pairing ? pairing.expiresAt - now : 0
  useEffect(() => {
    // The code ran out while the page was open: show a fresh one.
    if (pairing && left <= 0) void window.tr.remote.newCode().then(setStatus)
  }, [pairing, left])

  const renew = () => void window.tr.remote.newCode().then(setStatus)
  const revoke = (id: string) => void window.tr.remote.revoke(id).then(setStatus)

  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>手机</h1>
        <div className={styles.first}>
          <Row label="允许手机连接">
            <Toggle label="允许手机连接" checked={remote.enabled} onChange={(enabled) => update({ enabled })} />
          </Row>
        </div>
        {remote.enabled && status && !status.listening && status.error && (
          <div className={styles.problem} role="status">
            <StatusGlyph status="error" />
            <span>{status.error.includes('EADDRINUSE') ? `端口 ${status.port} 已被占用` : '没能开始监听'}</span>
          </div>
        )}
        {status?.listening && status.pairingLocked && (
          <div className={styles.problem} role="status">
            <StatusGlyph status="error" />
            <span className={styles.grow}>配对码输错太多次，已作废</span>
            <button type="button" className={styles.secondary} onClick={renew}>
              换一个
            </button>
          </div>
        )}
        {pairing && (
          <div className={styles.pairing} aria-label="配对">
            <Qr link={pairing.link} />
            <div className={styles.code}>
              <span className={styles.caption}>配对码</span>
              <span className={styles.codeText}>{formatPairingCode(pairing.code)}</span>
              <span className={styles.expires}>{expiresText(left)}</span>
              <button type="button" className={styles.secondary} onClick={renew}>
                换一个
              </button>
            </div>
          </div>
        )}
        {remote.enabled && status?.listening && (
          <Section title="地址">
            {status.addresses.length === 0 && <div className={styles.empty}>没有可用的网络地址</div>}
            {status.addresses.map((a) => (
              <div key={a.url} className={styles.line}>
                <span className={styles.lead}>
                  <span>{a.kind === 'tailscale' ? 'Tailscale' : '局域网'}</span>
                  <span className={styles.mono}>{a.host}</span>
                </span>
                <span className={styles.meta}>{a.kind === 'tailscale' ? '已发布' : '同一个 Wi-Fi'}</span>
              </div>
            ))}
          </Section>
        )}
        {status && status.devices.length > 0 && (
          <Section title="已配对的设备">
            {status.devices.map((d) => (
              <div key={d.id} className={styles.line}>
                <span className={styles.lead}>
                  <Smartphone size={16} strokeWidth={1.75} className={styles.icon} />
                  <span className={styles.name}>{d.name}</span>
                </span>
                {d.online ? (
                  <span className={styles.online}>
                    <StatusGlyph status="done_unread" />
                    <span>在线</span>
                  </span>
                ) : (
                  <span className={styles.mono}>{lastSeenText(d.lastSeenAt, now)}</span>
                )}
                <button type="button" className={styles.ghost} onClick={() => revoke(d.id)}>
                  撤销
                </button>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}
