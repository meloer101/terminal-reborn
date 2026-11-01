// The phone link's cryptography (PRD F22), with Node's own crypto only: X25519 for pairing, HKDF-SHA256 for keys,
// HMAC-SHA256 to prove a paired device knows its secret, AES-256-GCM for every frame (Electron's BoringSSL has no
// ChaCha20-Poly1305 cipher; measured 2026-11-01). The phone app does the same
// with audited pure-JS libraries (@noble/curves, @noble/hashes, @noble/ciphers), so nothing here may use a Node-only
// construction.
//
//   pairing: phone → { t: 'pair', key: phone X25519 public, box }   box = seal(k, nonce 0, { name })
//            k = HKDF(X25519(mac, phone), salt = code, info = 'wavi pair v1')        a wrong code fails to open
//            Wavi → { t: 'paired', box }                              box = seal(k, nonce 1, { device, secret, name })
//   session: phone → { t: 'hello', device }    Wavi → { t: 'challenge', nonce: s }
//            phone → { t: 'auth', nonce: c, proof }   proof = HMAC(secret, 'wavi auth v1' ‖ s ‖ c)
//            keys = HKDF(secret, salt = s ‖ c, info = 'wavi session v1', 64): phone→Wavi, then Wavi→phone
//   frames:  8-byte big-endian counter ‖ seal(key, 4 zero bytes ‖ counter, json); counters only go up
import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto'

export const PAIR_INFO = 'wavi pair v1'
export const AUTH_INFO = 'wavi auth v1'
export const SESSION_INFO = 'wavi session v1'
const TAG = 16

export const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/** base64url → bytes of exactly `length`, or null. */
export function fromB64u(text: unknown, length?: number): Buffer | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 4096) return null
  const bytes = Buffer.from(text, 'base64url')
  return length === undefined || bytes.length === length ? bytes : null
}

export interface Identity {
  privateKey: KeyObject
  /** Raw 32-byte X25519 public key, base64url (what the QR code carries). */
  publicKey: string
}

export function newIdentity(): Identity {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  return { privateKey, publicKey: publicKey.export({ format: 'jwk' }).x as string }
}

export function identityToPem(identity: Identity): string {
  return identity.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string
}

export function identityFromPem(pem: string): Identity | null {
  try {
    const privateKey = createPrivateKey(pem)
    if (privateKey.asymmetricKeyType !== 'x25519') return null
    return { privateKey, publicKey: createPublicKey(privateKey).export({ format: 'jwk' }).x as string }
  } catch {
    return null
  }
}

/** X25519 with a peer's raw public key; null when the key is not one. */
export function sharedSecret(own: KeyObject, peerPublic: string): Buffer | null {
  if (!fromB64u(peerPublic, 32)) return null
  try {
    const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: peerPublic }, format: 'jwk' })
    return diffieHellman({ privateKey: own, publicKey })
  } catch {
    return null
  }
}

export const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: string, length = 32): Buffer => Buffer.from(hkdfSync('sha256', ikm, salt, info, length))

export function nonceOf(counter: number): Buffer {
  const nonce = Buffer.alloc(12)
  nonce.writeBigUInt64BE(BigInt(counter), 4)
  return nonce
}

export function seal(key: Uint8Array, counter: number, plaintext: Uint8Array): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonceOf(counter), { authTagLength: TAG })
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

export function open(key: Uint8Array, counter: number, sealed: Uint8Array): Buffer | null {
  if (sealed.length < TAG) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonceOf(counter), { authTagLength: TAG })
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG))
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()])
  } catch {
    return null
  }
}

/** The key a pairing attempt is sealed with: only someone who scanned (or typed) `code` gets it right. */
export function pairingKey(own: KeyObject, phonePublic: string, code: string): Buffer | null {
  const shared = sharedSecret(own, phonePublic)
  return shared ? hkdf(shared, Buffer.from(code, 'utf8'), PAIR_INFO) : null
}

export function authProof(secret: Uint8Array, serverNonce: Uint8Array, clientNonce: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(AUTH_INFO).update(serverNonce).update(clientNonce).digest()
}

export function proofMatches(expected: Buffer, given: Buffer | null): boolean {
  return given !== null && given.length === expected.length && timingSafeEqual(expected, given)
}

export function sessionKeys(secret: Uint8Array, serverNonce: Uint8Array, clientNonce: Uint8Array): { fromPhone: Buffer; toPhone: Buffer } {
  const material = hkdf(secret, Buffer.concat([serverNonce, clientNonce]), SESSION_INFO, 64)
  return { fromPhone: material.subarray(0, 32), toPhone: material.subarray(32) }
}

export const randomToken = (bytes: number): Buffer => randomBytes(bytes)

/**
 * One direction of an authenticated connection: frames carry their counter, which must grow, so a recorded frame
 * cannot be played back and two frames never share a nonce.
 */
export class FrameCipher {
  private sent = 0
  private received = -1

  constructor(
    private readonly sendKey: Buffer,
    private readonly receiveKey: Buffer
  ) {}

  seal(value: unknown): Buffer {
    const counter = this.sent++
    const head = Buffer.alloc(8)
    head.writeBigUInt64BE(BigInt(counter))
    return Buffer.concat([head, seal(this.sendKey, counter, Buffer.from(JSON.stringify(value), 'utf8'))])
  }

  /** The frame's JSON, or null when it was tampered with, replayed or not JSON. */
  open(frame: Uint8Array): unknown {
    if (frame.length < 8 + TAG) return null
    const counter = Number(Buffer.from(frame.subarray(0, 8)).readBigUInt64BE())
    if (!Number.isSafeInteger(counter) || counter <= this.received) return null
    const plain = open(this.receiveKey, counter, frame.subarray(8))
    if (!plain) return null
    this.received = counter
    try {
      return JSON.parse(plain.toString('utf8')) as unknown
    } catch {
      return null
    }
  }
}
