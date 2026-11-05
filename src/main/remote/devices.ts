// Paired phones (PRD F22, 设置 · 手机 · 已配对的设备): each has its own 32-byte secret, kept in a 0600 file under
// userData next to the Mac's identity. Revoking one deletes its secret, so it cannot connect again until it pairs anew.
// Electron-free: index.ts gives it the file.
import { b64u, fromB64u, randomToken } from './crypto'

export interface StoredDevice {
  id: string
  name: string
  /** base64url of 32 bytes. */
  secret: string
  pairedAt: number
  lastSeenAt: number | null
}

export interface DeviceIo {
  load(): unknown
  save(devices: StoredDevice[]): void
}

const MAX_DEVICES = 20

function parse(raw: unknown): StoredDevice[] {
  if (!Array.isArray(raw)) return []
  const out: StoredDevice[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const d = item as Record<string, unknown>
    if (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(d.id) || typeof d.name !== 'string' || !fromB64u(d.secret, 32)) continue
    out.push({
      id: d.id,
      name: d.name.slice(0, 80),
      secret: d.secret as string,
      pairedAt: typeof d.pairedAt === 'number' ? d.pairedAt : 0,
      lastSeenAt: typeof d.lastSeenAt === 'number' ? d.lastSeenAt : null
    })
  }
  return out.slice(0, MAX_DEVICES)
}

export class DeviceStore {
  private devices: StoredDevice[]

  constructor(
    private readonly io: DeviceIo,
    private readonly now: () => number = Date.now
  ) {
    this.devices = parse(io.load())
  }

  list(): readonly StoredDevice[] {
    return this.devices
  }

  get(id: unknown): StoredDevice | undefined {
    return typeof id === 'string' ? this.devices.find((d) => d.id === id) : undefined
  }

  /** A newly paired phone; the oldest ones go when there are already MAX_DEVICES (`evicted`, to disconnect). */
  add(name: string): { device: StoredDevice; evicted: string[] } {
    const device: StoredDevice = {
      id: b64u(randomToken(12)),
      name: name.trim().slice(0, 80) || 'iPhone',
      secret: b64u(randomToken(32)),
      pairedAt: this.now(),
      lastSeenAt: this.now()
    }
    const all = [...this.devices, device]
    const evicted = all.slice(0, Math.max(0, all.length - MAX_DEVICES)).map((d) => d.id)
    this.devices = all.slice(-MAX_DEVICES)
    this.io.save(this.devices)
    return { device, evicted }
  }

  remove(id: string): boolean {
    const next = this.devices.filter((d) => d.id !== id)
    if (next.length === this.devices.length) return false
    this.devices = next
    this.io.save(this.devices)
    return true
  }

  touch(id: string): void {
    const device = this.get(id)
    if (!device) return
    device.lastSeenAt = this.now()
    this.io.save(this.devices)
  }
}
