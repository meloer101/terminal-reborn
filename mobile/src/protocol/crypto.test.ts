import { describe, expect, it } from 'vitest'
import * as mac from '../../../src/main/remote/crypto'
import { authProof, b64u, FrameCipher, fromB64u, fromUtf8, newKeyPair, open, pairingKey, pakeStart, seal, sessionKeys, utf8 } from './crypto'

const buf = (bytes: Uint8Array) => Buffer.from(bytes)

describe('the phone speaks the Mac crypto', () => {
  it('derives the same pairing key, and opens what the other side sealed', () => {
    const identity = mac.newIdentity()
    const phone = newKeyPair()
    const onPhone = pairingKey(phone.secretKey, identity.publicKey, '4KX92Q')!
    const onMac = mac.pairingKey(identity.privateKey, phone.publicKey, '4KX92Q')!
    expect(buf(onPhone).equals(onMac)).toBe(true)
    expect(mac.open(onMac, 0, buf(seal(onPhone, 0, utf8('{"name":"iPhone"}'))))?.toString()).toBe('{"name":"iPhone"}')
    expect(fromUtf8(open(onPhone, 1, mac.seal(onMac, 1, Buffer.from('续期')))!)).toBe('续期')
    expect(buf(pairingKey(phone.secretKey, identity.publicKey, '4KX92R')!).equals(onMac)).toBe(false)
  })

  it('proves the device secret and derives the same session keys', () => {
    const secret = mac.randomToken(32)
    const s = mac.randomToken(16)
    const c = mac.randomToken(16)
    expect(buf(authProof(secret, s, c)).equals(mac.authProof(secret, s, c))).toBe(true)
    const phoneKeys = sessionKeys(secret, s, c)
    const macKeys = mac.sessionKeys(secret, s, c)
    expect(buf(phoneKeys.fromPhone).equals(macKeys.fromPhone)).toBe(true)
    expect(buf(phoneKeys.toPhone).equals(macKeys.toPhone)).toBe(true)
  })

  it('exchanges frames both ways and refuses a replay', () => {
    const k1 = mac.randomToken(32)
    const k2 = mac.randomToken(32)
    const phone = new FrameCipher(k1, k2)
    const wavi = new mac.FrameCipher(k2, k1)
    const first = phone.seal({ id: 1, type: 'snapshot', text: '中文' })
    expect(wavi.open(first)).toEqual({ id: 1, type: 'snapshot', text: '中文' })
    expect(wavi.open(first)).toBeNull()
    expect(phone.open(wavi.seal({ re: 1, ok: true }))).toEqual({ re: 1, ok: true })
  })

  it('learns the Mac key through the PAKE only with the right code', () => {
    const identity = mac.newIdentity()
    const right = pakeStart('4KX92Q')
    const reply = mac.pakeReply('4KX92Q', right.a, identity.publicKey)!
    expect(right.finish(reply.b, reply.box)).toBe(identity.publicKey)
    const wrong = pakeStart('4KX92R')
    const refused = mac.pakeReply('4KX92Q', wrong.a, identity.publicKey)!
    expect(wrong.finish(refused.b, refused.box)).toBeNull()
    // Not a group element, or the identity: no answer at all.
    expect(mac.pakeReply('4KX92Q', b64u(new Uint8Array(32)), identity.publicKey)).toBeNull()
    expect(mac.pakeReply('4KX92Q', 'not-base64!', identity.publicKey)).toBeNull()
  })

  it('reads base64url the way the Mac writes it', () => {
    const bytes = mac.randomToken(33)
    expect(buf(fromB64u(mac.b64u(bytes))!).equals(bytes)).toBe(true)
    expect(b64u(bytes)).toBe(mac.b64u(bytes))
    expect(fromB64u('abc', 32)).toBeNull()
  })
})
