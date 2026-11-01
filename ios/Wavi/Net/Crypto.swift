// The phone's half of the link's cryptography (PRD F22): the same handshake and frames as the Mac's
// src/main/remote/crypto.ts, which holds the protocol description. CryptoKit for X25519, HKDF, HMAC and AES-GCM;
// libsodium's ristretto255 group (Packages/Ristretto255, ISC) for the typed-code PAKE, which CryptoKit lacks.
// WaviTests/CryptoTests.swift checks every function byte for byte against src/shared/remote-vectors.json.
import CRistretto255
import CryptoKit
import Foundation

enum WaviCrypto {
  static let pairInfo = "wavi pair v1"
  static let pakeInfo = "wavi pake v1"
  static let authInfo = "wavi auth v1"
  static let sessionInfo = "wavi session v1"
  static let tag = 16

  static func b64u(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  /// base64url → bytes of exactly `count`, or nil.
  static func fromB64u(_ text: String, count: Int? = nil) -> Data? {
    guard text.count <= 4096, text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
    var padded = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    padded += String(repeating: "=", count: (4 - padded.count % 4) % 4)
    guard let data = Data(base64Encoded: padded) else { return nil }
    return count == nil || data.count == count ? data : nil
  }

  static func random(_ count: Int) -> Data {
    var bytes = [UInt8](repeating: 0, count: count)
    _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    return Data(bytes)
  }

  static func hkdf(_ ikm: Data, salt: Data, info: String, count: Int = 32) -> Data {
    HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: salt, info: Data(info.utf8), outputByteCount: count).withUnsafeBytes { Data($0) }
  }

  /// 4 zero bytes, then the counter as 8 big-endian bytes.
  static func nonce(_ counter: UInt64) -> Data {
    var data = Data(count: 4)
    withUnsafeBytes(of: counter.bigEndian) { data.append(contentsOf: $0) }
    return data
  }

  /// AES-256-GCM: ciphertext ‖ 16-byte tag, no nonce in front (it comes from the counter).
  static func seal(key: Data, counter: UInt64, _ plaintext: Data) -> Data {
    // A 12-byte nonce and a 32-byte key never make these throw.
    let box = try! AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce(counter)))
    return box.ciphertext + box.tag
  }

  static func open(key: Data, counter: UInt64, _ sealed: Data) -> Data? {
    guard sealed.count >= tag, let nonce = try? AES.GCM.Nonce(data: nonce(counter)),
      let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: sealed.prefix(sealed.count - tag), tag: sealed.suffix(tag))
    else { return nil }
    return try? AES.GCM.open(box, using: SymmetricKey(data: key))
  }

  // MARK: Pairing

  static func newKey() -> Curve25519.KeyAgreement.PrivateKey { Curve25519.KeyAgreement.PrivateKey() }

  static func publicB64u(_ key: Curve25519.KeyAgreement.PrivateKey) -> String { b64u(key.publicKey.rawRepresentation) }

  /// The key a pairing attempt is sealed with (the Mac gets the same only with the same code); nil for a bad Mac key.
  static func pairingKey(own: Curve25519.KeyAgreement.PrivateKey, macPublic: String, code: String) -> Data? {
    guard let raw = fromB64u(macPublic, count: 32), let peer = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw),
      let shared = try? own.sharedSecretFromKeyAgreement(with: peer)
    else { return nil }
    return hkdf(shared.withUnsafeBytes { Data($0) }, salt: Data(code.utf8), info: pairInfo)
  }

  // MARK: Typed-code PAKE (CPace-style on ristretto255; the Mac's half is `pakeReply`)

  /// RFC 9380 §5.3.1 with SHA-512.
  static func expandMessageXMD(_ message: Data, dst: Data, count: Int) -> Data {
    let ell = (count + 63) / 64
    let dstPrime = dst + Data([UInt8(dst.count)])
    let msgPrime = Data(count: 128) + message + Data([UInt8(count >> 8), UInt8(count & 0xff), 0]) + dstPrime
    let b0 = Data(SHA512.hash(data: msgPrime))
    var blocks = [Data(SHA512.hash(data: b0 + Data([1]) + dstPrime))]
    for i in 2...max(ell, 2) where i <= ell {
      let mixed = Data(zip(b0, blocks[i - 2]).map { $0 ^ $1 })
      blocks.append(Data(SHA512.hash(data: mixed + Data([UInt8(i)]) + dstPrime)))
    }
    return blocks.reduce(Data(), +).prefix(count)
  }

  /// hash_to_ristretto255(code, DST = "wavi pake v1"): what @noble's `ristretto255_hasher.hashToCurve` gives.
  static func pakeBase(code: String) -> Data {
    let uniform = [UInt8](expandMessageXMD(Data(code.utf8), dst: Data(pakeInfo.utf8), count: 64))
    var point = [UInt8](repeating: 0, count: 32)
    _ = crypto_core_ristretto255_from_hash(&point, uniform)
    return Data(point)
  }

  /// scalar · point; nil when the point is not a valid encoding or the result is the identity.
  static func multiply(_ scalar: Data, _ point: Data) -> Data? {
    let p = [UInt8](point)
    guard p.count == 32, crypto_core_ristretto255_is_valid_point(p) == 1 else { return nil }
    var out = [UInt8](repeating: 0, count: 32)
    guard crypto_scalarmult_ristretto255(&out, [UInt8](scalar), p) == 0 else { return nil }
    return Data(out)
  }

  struct Pake {
    let a: String
    fileprivate let x: Data
    fileprivate let bytesA: Data

    /// The Mac's public key from its answer; nil means the code was wrong (or the answer is no good).
    func finish(b: String, box: String) -> String? {
      guard let bytesB = WaviCrypto.fromB64u(b, count: 32), let sealed = WaviCrypto.fromB64u(box),
        let shared = WaviCrypto.multiply(x, bytesB),
        let opened = WaviCrypto.open(key: WaviCrypto.hkdf(shared, salt: bytesA + bytesB, info: WaviCrypto.pakeInfo), counter: 0, sealed),
        let json = try? JSONSerialization.jsonObject(with: opened) as? [String: Any], let key = json["key"] as? String,
        WaviCrypto.fromB64u(key, count: 32) != nil
      else { return nil }
      return key
    }
  }

  /// `x` is fixed only by the test vectors; otherwise a uniform random scalar.
  static func pakeStart(code: String, x fixed: Data? = nil) -> Pake? {
    var x = [UInt8](repeating: 0, count: 32)
    if let fixed { x = [UInt8](fixed) } else { crypto_core_ristretto255_scalar_random(&x) }
    guard let a = multiply(Data(x), pakeBase(code: code)) else { return nil }
    return Pake(a: b64u(a), x: Data(x), bytesA: a)
  }

  // MARK: Session

  static func authProof(secret: Data, serverNonce: Data, clientNonce: Data) -> Data {
    Data(HMAC<SHA256>.authenticationCode(for: Data(authInfo.utf8) + serverNonce + clientNonce, using: SymmetricKey(data: secret)))
  }

  static func sessionKeys(secret: Data, serverNonce: Data, clientNonce: Data) -> (fromPhone: Data, toPhone: Data) {
    let material = hkdf(secret, salt: serverNonce + clientNonce, info: sessionInfo, count: 64)
    return (material.prefix(32), material.suffix(32))
  }
}

/// One authenticated connection: frames carry a growing counter, so none can be replayed and no nonce repeats.
struct FrameCipher {
  private let sendKey: Data
  private let receiveKey: Data
  private var sent: UInt64 = 0
  private var received: Int64 = -1

  init(sendKey: Data, receiveKey: Data) {
    self.sendKey = sendKey
    self.receiveKey = receiveKey
  }

  mutating func seal(_ json: Data) -> Data {
    let counter = sent
    sent += 1
    var head = Data()
    withUnsafeBytes(of: counter.bigEndian) { head.append(contentsOf: $0) }
    return head + WaviCrypto.seal(key: sendKey, counter: counter, json)
  }

  /// The frame's JSON bytes, or nil when it was tampered with or replayed.
  mutating func open(_ frame: Data) -> Data? {
    guard frame.count >= 8 + WaviCrypto.tag else { return nil }
    let counter = frame.prefix(8).reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
    guard counter < 1 << 53, Int64(counter) > received,
      let plain = WaviCrypto.open(key: receiveKey, counter: counter, frame.dropFirst(8))
    else { return nil }
    received = Int64(counter)
    return plain
  }
}
