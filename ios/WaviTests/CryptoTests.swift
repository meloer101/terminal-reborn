// The Swift crypto against the Mac's, byte for byte: src/shared/remote-vectors.json is written by the Mac's own
// functions (src/main/remote/vectors.test.ts).
import CryptoKit
import Foundation
import Testing
@testable import Wavi

private final class Marker {}

private struct Vectors: Decodable {
  struct X25519: Decodable { let phoneSecret, macSecret, phonePublicB64u, macPublicB64u, shared, code, pairingKey: String }
  struct Seal: Decodable { let key: String; let counter: UInt64; let plaintext, sealed: String }
  struct Pake: Decodable { let code, dst, base, x, a, y, bB64u, key, boxB64u, macPublicB64u: String }
  struct Session: Decodable { let secret, serverNonce, clientNonce, proof, fromPhone, toPhone: String; let frames, framePlaintexts: [String] }
  let x25519: X25519
  let seal: [Seal]
  let pake: Pake
  let session: Session

  static func load() throws -> Vectors {
    let url = try #require(Bundle(for: Marker.self).url(forResource: "remote-vectors", withExtension: "json"))
    return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
  }
}

private func hex(_ text: String) -> Data {
  Data(stride(from: 0, to: text.count, by: 2).map { i in
    UInt8(text[text.index(text.startIndex, offsetBy: i)..<text.index(text.startIndex, offsetBy: i + 2)], radix: 16)!
  })
}

private func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

@Suite struct CryptoTests {
  @Test func pairingKeyMatchesTheMac() throws {
    let v = try Vectors.load().x25519
    let phone = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: hex(v.phoneSecret))
    #expect(WaviCrypto.publicB64u(phone) == v.phonePublicB64u)
    #expect(hex(try #require(WaviCrypto.pairingKey(own: phone, macPublic: v.macPublicB64u, code: v.code))) == v.pairingKey)
    #expect(WaviCrypto.pairingKey(own: phone, macPublic: "not a key", code: v.code) == nil)
  }

  @Test func sealAndOpenMatchTheMac() throws {
    for v in try Vectors.load().seal {
      #expect(hex(WaviCrypto.seal(key: hex(v.key), counter: v.counter, Data(v.plaintext.utf8))) == v.sealed)
      #expect(WaviCrypto.open(key: hex(v.key), counter: v.counter, hex(v.sealed)) == Data(v.plaintext.utf8))
      #expect(WaviCrypto.open(key: hex(v.key), counter: v.counter + 1, hex(v.sealed)) == nil)
    }
  }

  @Test func pakeMatchesTheMac() throws {
    let v = try Vectors.load().pake
    #expect(hex(WaviCrypto.pakeBase(code: v.code)) == v.base)
    let pake = try #require(WaviCrypto.pakeStart(code: v.code, x: hex(v.x)))
    #expect(hex(WaviCrypto.fromB64u(pake.a)!) == v.a)
    #expect(pake.finish(b: v.bB64u, box: v.boxB64u) == v.macPublicB64u)
    // Another code gives another base point, so the Mac's box does not open.
    #expect(WaviCrypto.pakeStart(code: "AAAAAA", x: hex(v.x))!.finish(b: v.bB64u, box: v.boxB64u) == nil)
    // The identity is refused.
    #expect(pake.finish(b: WaviCrypto.b64u(Data(count: 32)), box: v.boxB64u) == nil)
  }

  @Test func sessionMatchesTheMac() throws {
    let v = try Vectors.load().session
    #expect(hex(WaviCrypto.authProof(secret: hex(v.secret), serverNonce: hex(v.serverNonce), clientNonce: hex(v.clientNonce))) == v.proof)
    let keys = WaviCrypto.sessionKeys(secret: hex(v.secret), serverNonce: hex(v.serverNonce), clientNonce: hex(v.clientNonce))
    #expect(hex(keys.fromPhone) == v.fromPhone)
    #expect(hex(keys.toPhone) == v.toPhone)

    var phone = FrameCipher(sendKey: keys.fromPhone, receiveKey: keys.toPhone)
    #expect(hex(phone.seal(Data(v.framePlaintexts[0].utf8))) == v.frames[0])
    #expect(hex(phone.seal(Data(v.framePlaintexts[1].utf8))) == v.frames[1])

    // The Mac's side opens them in order and refuses a replay.
    var mac = FrameCipher(sendKey: keys.toPhone, receiveKey: keys.fromPhone)
    #expect(mac.open(hex(v.frames[0])) == Data(v.framePlaintexts[0].utf8))
    #expect(mac.open(hex(v.frames[1])) == Data(v.framePlaintexts[1].utf8))
    #expect(mac.open(hex(v.frames[0])) == nil)
  }

  @Test func base64url() {
    let data = Data([0xfb, 0xff, 0x00, 0x10])
    #expect(WaviCrypto.b64u(data) == "-_8AEA")
    #expect(WaviCrypto.fromB64u("-_8AEA") == data)
    #expect(WaviCrypto.fromB64u("-_8AEA", count: 3) == nil)
    #expect(WaviCrypto.fromB64u("a+b") == nil)
  }
}
