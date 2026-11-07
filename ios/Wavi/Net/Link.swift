// The phone's link to Wavi before it is authenticated (PRD F22): the socket, the pairing (a scanned QR code, or a typed
// code through the PAKE) and what both need — addresses, offers, the first plaintext messages. The Mac's side is
// src/main/remote/server.ts; the handshake is described in src/main/remote/crypto.ts.
import Foundation

struct Pairing: Codable, Equatable, Sendable {
  var device: String
  /// base64url of the 32-byte device secret.
  var secret: String
  var macName: String
  /// Where to reach the Mac, Tailscale first.
  var urls: [String]
}

/// What the QR code on 设置 · 手机 carries.
struct PairingOffer: Equatable, Sendable {
  let name: String
  let urls: [String]
  let code: String
  let key: String
}

/// A failure the pairing screen shows as it is.
struct PairError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

/// The Mac said it does not know this phone (or something else before the session opened).
struct Refused: Error {
  let reason: String
  var isUnknownDevice: Bool { ["unknown device", "bad proof", "revoked"].contains(reason) }
}

struct Timeout: Error {}

enum AddressFailure: Hashable, Sendable { case portClosed, timeout, noNetwork, other }

/// Why the phone has no link, as the connection line says it (Figma 62A–62D).
enum OfflineReason: Equatable, Sendable { case macAsleep, waviNotRunning, tailscaleOff, noNetwork, macOutdated, phoneOutdated, unknown }

enum Link {
  static let openSeconds = 6.0
  static let replySeconds = 10.0
  static let requestSeconds = 20.0
  static let retrySeconds: [Double] = [1, 2, 4, 8, 15]
  /// A link open at least this long held; one closed sooner backs off.
  static let heldFor: Double = 5
  static let maxURLs = 8

  /// What the phone typed or scanned → the bare code; nil when it cannot be one.
  static func normalizeCode(_ raw: String) -> String? {
    let code = raw.uppercased().filter { !$0.isWhitespace && $0 != "-" }
    let pairing = Shared.data.pairing
    return code.count == pairing.length && code.allSatisfy({ pairing.alphabet.contains($0) }) ? code : nil
  }

  /// `wavi://pair?d=…` → the offer; nil when it is not one.
  static func parseOffer(_ link: String) -> PairingOffer? {
    guard let m = link.trimmingCharacters(in: .whitespacesAndNewlines).wholeMatch(of: /wavi:\/\/pair\?d=([A-Za-z0-9_-]+)/),
      let bytes = WaviCrypto.fromB64u(String(m.1)),
      let o = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
      o["v"] as? Int == 1, let code = (o["code"] as? String).flatMap(normalizeCode),
      let key = o["key"] as? String, WaviCrypto.fromB64u(key, count: 32) != nil
    else { return nil }
    let urls = mergeURLs(o["urls"] as? [String] ?? [], current: nil, known: [])
    guard !urls.isEmpty else { return nil }
    return PairingOffer(name: String((o["name"] as? String ?? "Mac").prefix(80)), urls: urls, code: code, key: key)
  }

  /// What someone typed as the Mac's address (`100.101.1.2`, `192.168.1.5:7429`, `ws://…`) → a URL; nil when it is none.
  static func addressURL(_ raw: String, defaultPort: Int) -> String? {
    var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    text = text.replacing(/^wss?:\/\//, with: "")
    if text.hasSuffix("/") { text.removeLast() }
    guard let m = text.wholeMatch(of: /([A-Za-z0-9.-]+)(?::(\d{2,5}))?/) else { return nil }
    let port = m.2.flatMap { Int($0) } ?? defaultPort
    return (1...65535).contains(port) ? "ws://\(m.1):\(port)" : nil
  }

  /// Where to reach the Mac after it reported its addresses: those, the one in use and the ones already known, without
  /// duplicates. Nothing is dropped for being absent from the report (a Tailscale down for a moment, a typed address).
  static func mergeURLs(_ reported: [String], current: String?, known: [String]) -> [String] {
    var seen = Set<String>()
    return (reported + [current].compactMap { $0 } + known)
      .filter { $0.wholeMatch(of: /wss?:\/\/[^\s\/]+/) != nil && seen.insert($0).inserted }
      .prefix(maxURLs).map { $0 }
  }

  /// Every address at once; the first to open wins and the others are closed.
  /// Why each address could not be opened: in words for the Mac line's dialog, and as a kind for the connection line.
  struct OpenFailed: Error {
    let reasons: [String: String]
    var kinds: [String: AddressFailure] = [:]
  }

  /// An address refused at once (the Mac is there, nothing listens), timed out (asleep, off this network), or the phone
  /// has no network. URLError.cannotConnectToHost covers both a refusal and an unreachable host; only a refusal is
  /// that quick. Measured on the simulator; on an iPhone over Tailscale, 未确认.
  static let refusedWithin = 1.5

  static func kind(_ error: Error, elapsed: Double) -> AddressFailure {
    if error is Timeout { return .timeout }
    guard let url = error as? URLError else { return .other }
    switch url.code {
    case .notConnectedToInternet: return .noNetwork
    case .timedOut: return .timeout
    case .cannotConnectToHost: return elapsed < refusedWithin ? .portClosed : .timeout
    default: return .other
    }
  }

  /// What the connection line says when no address opened (Figma 62).
  static func offlineReason(_ failures: [String: AddressFailure], tailscaleUp: Bool) -> OfflineReason {
    let kinds = Set(failures.values)
    if kinds.contains(.noNetwork) { return .noNetwork }
    if kinds.contains(.portClosed) { return .waviNotRunning }
    guard kinds.contains(.timeout) else { return .unknown }
    if !tailscaleUp && failures.keys.contains(where: isTailscale) { return .tailscaleOff }
    return .macAsleep
  }

  /// A Tailscale address: 100.64.0.0/10 or a MagicDNS name.
  static func isTailscale(_ url: String) -> Bool {
    guard let host = URL(string: url)?.host else { return false }
    return host.hasSuffix(".ts.net") || isTailscaleIPv4(host)
  }

  static func isTailscaleIPv4(_ text: String) -> Bool {
    let parts = text.split(separator: ".").compactMap { Int($0) }
    return parts.count == 4 && parts[0] == 100 && (64...127).contains(parts[1])
  }

  /// This phone has a Tailscale address (Tailscale is connected here). A VPN tunnel alone does not say so: iOS keeps
  /// utun interfaces of its own.
  static func tailscaleUp() -> Bool {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return false }
    defer { freeifaddrs(list) }
    for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
      guard let addr = entry.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0,
        isTailscaleIPv4(String(cString: host)) { return true }
    }
    return false
  }

  /// Which side needs updating when their protocols differ (src/shared/remote.ts REMOTE_PROTOCOL); a Mac without it
  /// in hello speaks 1.
  static func protocolMismatch(mac: Int?, phone: Int) -> OfflineReason? {
    let spoken = mac ?? 1
    if spoken < phone { return .macOutdated }
    if spoken > phone { return .phoneOutdated }
    return nil
  }

  static func reason(_ error: Error) -> String {
    if error is Timeout { return "超时（\(Int(openSeconds)) 秒没有回应）" }
    if let url = error as? URLError {
      switch url.code {
      case .notConnectedToInternet: return "没有网络"
      case .cannotConnectToHost: return "连不上（端口没开或被拒绝）"
      case .timedOut: return "超时"
      case .cannotFindHost, .dnsLookupFailed: return "找不到这个地址"
      case .networkConnectionLost: return "连接断了"
      case .appTransportSecurityRequiresSecureConnection: return "被 iOS 的 ATS 拦下"
      default: return "URLError \(url.code.rawValue)"
      }
    }
    return String(describing: error)
  }

  static func firstOpen(_ urls: [String]) async throws -> Socket {
    let sockets = urls.compactMap(Socket.init(url:))
    guard !sockets.isEmpty else { throw OpenFailed(reasons: [:]) }
    var reasons: [String: String] = [:]
    var kinds: [String: AddressFailure] = [:]
    let winner = await withTaskGroup(of: (Socket, (String, AddressFailure)?).self) { group -> Socket? in
      for socket in sockets {
        group.addTask {
          let started = Date()
          do {
            try await withTimeout(openSeconds, onTimeout: socket.close) { try await socket.waitOpen() }
            return (socket, nil)
          } catch {
            socket.close()
            return (socket, (reason(error), kind(error, elapsed: Date().timeIntervalSince(started))))
          }
        }
      }
      var winner: Socket?
      for await (socket, failure) in group {
        if let failure {
          if winner == nil {
            reasons[socket.url] = failure.0
            kinds[socket.url] = failure.1
          }
          continue
        }
        let opened = socket
        if winner == nil {
          winner = opened
          // The others give up at once instead of when their timeout runs out.
          for other in sockets where other !== opened { other.close() }
        } else {
          opened.close()
        }
      }
      return winner
    }
    guard let winner else { throw OpenFailed(reasons: reasons, kinds: kinds) }
    return winner
  }

  /// The next plaintext handshake message (an object; `{}` when it is not JSON).
  static func nextText(_ socket: Socket) async throws -> [String: Any] {
    let message = try await withTimeout(replySeconds, onTimeout: socket.close) { try await socket.receive() }
    guard case .string(let text) = message, let data = text.data(using: .utf8),
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    return value
  }

  static func text(_ value: [String: Any]) -> String {
    (try? JSONSerialization.data(withJSONObject: value)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
  }

  private static let pairErrors = ["no pairing code": "配对码已失效，在 Mac 上点「换一个」", "wrong code": "配对码不对"]

  private static func pairOn(_ socket: Socket, macKey: String, code: String, phoneName: String, urls: [String]) async throws -> Pairing {
    let me = WaviCrypto.newKey()
    guard let key = WaviCrypto.pairingKey(own: me, macPublic: macKey, code: code) else { throw PairError("二维码不对") }
    let box = WaviCrypto.seal(key: key, counter: 0, Data(text(["name": phoneName]).utf8))
    try await socket.send(text: text(["t": "pair", "key": WaviCrypto.publicB64u(me), "box": WaviCrypto.b64u(box)]))
    let reply = try await nextText(socket)
    guard reply["t"] as? String == "paired" else { throw PairError(pairErrors[reply["error"] as? String ?? ""] ?? "配对没有成功") }
    guard let sealed = (reply["box"] as? String).flatMap({ WaviCrypto.fromB64u($0) }), let body = WaviCrypto.open(key: key, counter: 1, sealed),
      let paired = try? JSONSerialization.jsonObject(with: body) as? [String: Any], let device = paired["device"] as? String,
      let secret = paired["secret"] as? String, WaviCrypto.fromB64u(secret, count: 32) != nil
    else { throw PairError("配对没有成功") }
    return Pairing(device: device, secret: secret, macName: paired["name"] as? String ?? "Mac", urls: urls)
  }

  private static func connectFor<T: Sendable>(_ urls: [String], _ run: (Socket) async throws -> T) async throws -> T {
    let socket: Socket
    do {
      socket = try await firstOpen(urls)
    } catch {
      throw PairError("连不上这台 Mac：Mac 上的 Wavi 要开着，手机和 Mac 在同一个 Wi-Fi 或 Tailscale 里")
    }
    defer { socket.close() }
    do {
      return try await run(socket)
    } catch let error as PairError {
      throw error
    } catch {
      throw PairError("配对没有成功")
    }
  }

  static func pair(offer: PairingOffer, phoneName: String) async throws -> Pairing {
    try await connectFor(offer.urls) { try await pairOn($0, macKey: offer.key, code: offer.code, phoneName: phoneName, urls: offer.urls) }
  }

  /// 输入配对码: the PAKE brings the Mac's public key, then the phone pairs as after a scan.
  static func pair(url: String, rawCode: String, phoneName: String) async throws -> Pairing {
    guard let code = normalizeCode(rawCode) else { throw PairError("配对码是 6 位字母和数字") }
    return try await connectFor([url]) { socket in
      guard let pake = WaviCrypto.pakeStart(code: code) else { throw PairError("配对没有成功") }
      try await socket.send(text: text(["t": "pake", "a": pake.a]))
      let reply = try await nextText(socket)
      guard reply["t"] as? String == "pake" else { throw PairError(pairErrors[reply["error"] as? String ?? ""] ?? "配对没有成功") }
      guard let macKey = pake.finish(b: reply["b"] as? String ?? "", box: reply["box"] as? String ?? "") else { throw PairError("配对码不对") }
      return try await pairOn(socket, macKey: macKey, code: code, phoneName: phoneName, urls: [url])
    }
  }
}

/// One WebSocket to the Mac. `waitOpen` answers once the server has answered a ping.
final class Socket: @unchecked Sendable {
  let url: String
  private let task: URLSessionWebSocketTask

  init?(url: String) {
    guard let parsed = URL(string: url) else { return nil }
    self.url = url
    task = URLSession.shared.webSocketTask(with: parsed)
    // Photos ride in one frame (REMOTE_LIMITS.frameBytes is 90 MB).
    task.maximumMessageSize = 96 * 1024 * 1024
    task.resume()
  }

  func waitOpen() async throws {
    let once = Once()
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
      task.sendPing { error in
        guard once.first() else { return }
        if let error { done.resume(throwing: error) } else { done.resume() }
      }
    }
  }

  func send(text: String) async throws { try await task.send(.string(text)) }
  func send(data: Data) async throws { try await task.send(.data(data)) }
  /// Queued at once, in call order; `done(failed)` when it is written or cannot be.
  func send(data: Data, done: @escaping @Sendable (Bool) -> Void) { task.send(.data(data)) { done($0 != nil) } }
  func receive() async throws -> URLSessionWebSocketTask.Message { try await task.receive() }
  /// 4001 (unknown device / bad proof), 4003 (revoked), … after the socket closed.
  var closeCode: Int { task.closeCode.rawValue }
  func close() { task.cancel(with: .normalClosure, reason: nil) }
}

/// True the first time only (a URLSession callback may fire more than once on failure).
private final class Once: @unchecked Sendable {
  private let lock = NSLock()
  private var done = false
  func first() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if done { return false }
    done = true
    return true
  }
}

/// `operation` or `Timeout` after `seconds`; `onTimeout` runs first (closing the socket ends a pending receive, which does
/// not stop for task cancellation).
func withTimeout<T: Sendable>(_ seconds: Double, onTimeout: @escaping @Sendable () -> Void = {}, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await operation() }
    group.addTask {
      try await Task.sleep(for: .seconds(seconds))
      onTimeout()
      throw Timeout()
    }
    defer { group.cancelAll() }
    guard let first = try await group.next() else { throw Timeout() }
    return first
  }
}
