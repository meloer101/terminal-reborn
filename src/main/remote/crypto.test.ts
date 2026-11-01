import { describe, expect, it } from 'vitest'
import { authProof, b64u, FrameCipher, fromB64u, identityFromPem, identityToPem, newIdentity, open, pairingKey, proofMatches, seal, sessionKeys } from './crypto'

describe('pairing key', () => {
  it('is the same on both sides with the right code and different with a wrong one', () => {
    const mac = newIdentity()
    const phone = newIdentity()
    const onMac = pairingKey(mac.privateKey, phone.publicKey, '4KX92Q')
    const onPhone = pairingKey(phone.privateKey, mac.publicKey, '4KX92Q')
    expect(onMac).not.toBeNull()
    expect(onMac!.equals(onPhone!)).toBe(true)
    const box = seal(onPhone!, 0, Buffer.from('{"name":"iPhone"}'))
    expect(open(onMac!, 0, box)?.toString()).toBe('{"name":"iPhone"}')
    const wrong = pairingKey(mac.privateKey, phone.publicKey, '4KX92R')!
    expect(open(wrong, 0, box)).toBeNull()
  })

  it('refuses a public key that is not 32 bytes of base64url', () => {
    const mac = newIdentity()
    expect(pairingKey(mac.privateKey, 'short', '4KX92Q')).toBeNull()
    expect(pairingKey(mac.privateKey, b64u(Buffer.alloc(31)), '4KX92Q')).toBeNull()
  })

  it('keeps the Mac identity across a PEM round trip', () => {
    const mac = newIdentity()
    expect(identityFromPem(identityToPem(mac))?.publicKey).toBe(mac.publicKey)
    expect(identityFromPem('garbage')).toBeNull()
  })
})

describe('session', () => {
  const secret = Buffer.alloc(32, 7)
  const s = Buffer.alloc(16, 1)
  const c = Buffer.alloc(16, 2)

  it('accepts only the proof made with the device secret', () => {
    const proof = authProof(secret, s, c)
    expect(proofMatches(proof, authProof(secret, s, c))).toBe(true)
    expect(proofMatches(proof, authProof(Buffer.alloc(32, 8), s, c))).toBe(false)
    expect(proofMatches(proof, fromB64u('AAAA'))).toBe(false)
    expect(proofMatches(proof, null)).toBe(false)
  })

  it('carries frames both ways and refuses tampered, replayed and out-of-order frames', () => {
    const keys = sessionKeys(secret, s, c)
    const mac = new FrameCipher(keys.toPhone, keys.fromPhone)
    const phone = new FrameCipher(keys.fromPhone, keys.toPhone)
    const f1 = phone.seal({ id: 1, type: 'snapshot' })
    const f2 = phone.seal({ id: 2, type: 'snapshot' })
    expect(mac.open(f1)).toEqual({ id: 1, type: 'snapshot' })
    expect(mac.open(f1)).toBeNull()
    expect(mac.open(f2)).toEqual({ id: 2, type: 'snapshot' })
    const f3 = phone.seal({ id: 3 })
    f3.writeUInt8(f3.readUInt8(f3.length - 1) ^ 1, f3.length - 1)
    expect(mac.open(f3)).toBeNull()
    expect(phone.open(mac.seal({ re: 1, ok: true }))).toEqual({ re: 1, ok: true })
    // The other direction's key does not open a frame.
    expect(new FrameCipher(keys.fromPhone, keys.fromPhone).open(mac.seal({ x: 1 }))).toBeNull()
  })
})
