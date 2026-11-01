// The phone's half of the link's cryptography (PRD F22): the same handshake and frames as the Mac's
// src/main/remote/crypto.ts, which holds the protocol description. Audited pure-JS libraries only (@noble, MIT), since
// React Native has no Node crypto; crypto.test.ts runs every function against the Mac's.
import { gcm } from '@noble/ciphers/aes.js'
import { ristretto255, ristretto255_hasher, x25519 } from '@noble/curves/ed25519.js'
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'

export const PAIR_INFO = 'wavi pair v1'
export const PAKE_INFO = 'wavi pake v1'
export const AUTH_INFO = 'wavi auth v1'
export const SESSION_INFO = 'wavi session v1'
const TAG = 16

export { randomBytes }

const encoder = new TextEncoder()
export const utf8 = (text: string): Uint8Array => encoder.encode(text)

export function fromUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!
    let code = b
    if (b >= 0xf0) code = ((b & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f)
    else if (b >= 0xe0) code = ((b & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f)
    else if (b >= 0xc0) code = ((b & 0x1f) << 6) | (bytes[i++]! & 0x3f)
    out += String.fromCodePoint(code)
  }
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function b64u(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → bytes of exactly `length`, or null. */
export function fromB64u(text: unknown, length?: number): Uint8Array | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 4096) return null
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return length === undefined || bytes.length === length ? bytes : null
}

export const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: string, length = 32): Uint8Array => nobleHkdf(sha256, ikm, salt, utf8(info), length)

// Counters as 8 big-endian bytes with plain numbers (they stay below 2^53): no BigInt DataView calls, which Hermes may lack.
function writeCounter(view: DataView, at: number, counter: number): void {
  view.setUint32(at, Math.floor(counter / 2 ** 32))
  view.setUint32(at + 4, counter >>> 0)
}

const readCounter = (view: DataView): number => view.getUint32(0) * 2 ** 32 + view.getUint32(4)

export function nonceOf(counter: number): Uint8Array {
  const nonce = new Uint8Array(12)
  writeCounter(new DataView(nonce.buffer), 4, counter)
  return nonce
}

export const seal = (key: Uint8Array, counter: number, plaintext: Uint8Array): Uint8Array => gcm(key, nonceOf(counter)).encrypt(plaintext)

export function open(key: Uint8Array, counter: number, sealed: Uint8Array): Uint8Array | null {
  if (sealed.length < TAG) return null
  try {
    return gcm(key, nonceOf(counter)).decrypt(sealed)
  } catch {
    return null
  }
}

export interface KeyPair {
  secretKey: Uint8Array
  /** Raw 32-byte X25519 public key, base64url. */
  publicKey: string
}

export function newKeyPair(): KeyPair {
  const secretKey = randomBytes(32)
  return { secretKey, publicKey: b64u(x25519.getPublicKey(secretKey)) }
}

/** The key a pairing attempt is sealed with (same on the Mac only with the same code); null for a bad Mac key. */
export function pairingKey(own: Uint8Array, macPublic: string, code: string): Uint8Array | null {
  const peer = fromB64u(macPublic, 32)
  if (!peer) return null
  try {
    return hkdf(x25519.getSharedSecret(own, peer), utf8(code), PAIR_INFO)
  } catch {
    return null
  }
}

const pakeBase = (code: string) => ristretto255_hasher.hashToCurve(utf8(code), { DST: PAKE_INFO })

/** A typed-code PAKE: `a` goes to the Mac, `finish` opens its answer into the Mac's public key (null: wrong code). */
export function pakeStart(code: string): { a: string; finish: (b: unknown, box: unknown) => string | null } {
  const x = ristretto255_hasher.hashToScalar(randomBytes(64))
  const bytesA = pakeBase(code).multiply(x).toBytes()
  return {
    a: b64u(bytesA),
    finish: (b, box) => {
      const bytesB = fromB64u(b, 32)
      const sealed = fromB64u(box)
      if (!bytesB || !sealed) return null
      try {
        const pointB = ristretto255.Point.fromBytes(bytesB)
        if (pointB.is0()) return null
        const opened = open(hkdf(pointB.multiply(x).toBytes(), concat(bytesA, bytesB), PAKE_INFO), 0, sealed)
        const key = opened ? (JSON.parse(fromUtf8(opened)) as { key?: unknown }).key : null
        return typeof key === 'string' && fromB64u(key, 32) ? key : null
      } catch {
        return null
      }
    }
  }
}

export const authProof = (secret: Uint8Array, serverNonce: Uint8Array, clientNonce: Uint8Array): Uint8Array =>
  hmac(sha256, secret, concat(utf8(AUTH_INFO), serverNonce, clientNonce))

export function sessionKeys(secret: Uint8Array, serverNonce: Uint8Array, clientNonce: Uint8Array): { fromPhone: Uint8Array; toPhone: Uint8Array } {
  const material = hkdf(secret, concat(serverNonce, clientNonce), SESSION_INFO, 64)
  return { fromPhone: material.slice(0, 32), toPhone: material.slice(32) }
}

/** One authenticated connection: frames carry a growing counter, so none can be replayed and no nonce repeats. */
export class FrameCipher {
  private sent = 0
  private received = -1

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array
  ) {}

  seal(value: unknown): Uint8Array {
    const counter = this.sent++
    const head = new Uint8Array(8)
    writeCounter(new DataView(head.buffer), 0, counter)
    return concat(head, seal(this.sendKey, counter, utf8(JSON.stringify(value))))
  }

  /** The frame's JSON, or null when it was tampered with, replayed or not JSON. */
  open(frame: Uint8Array): unknown {
    if (frame.length < 8 + TAG) return null
    const counter = readCounter(new DataView(frame.buffer, frame.byteOffset, 8))
    if (!Number.isSafeInteger(counter) || counter <= this.received) return null
    const plain = open(this.receiveKey, counter, frame.subarray(8))
    if (!plain) return null
    this.received = counter
    try {
      return JSON.parse(fromUtf8(plain)) as unknown
    } catch {
      return null
    }
  }
}
