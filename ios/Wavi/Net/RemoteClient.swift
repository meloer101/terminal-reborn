// The paired phone's link to its Mac (PRD F22): connects to every known address at once, authenticates (hello →
// challenge → auth), then speaks encrypted frames — requests with an id and their answers, and the Mac's pushes — and
// reconnects after drops. Behaviour as the Expo app's client.ts had it; the generation counter keeps a closed socket's
// late callbacks out (as in the author's marvis-coding-agent RpcClient, MIT).
import Foundation

enum LinkState: Equatable, Sendable {
  case connecting
  case open(url: String)
  case offline(OfflineReason)
  /// Every address said it does not know this phone (revoked on the Mac, or another machine now has that address). The
  /// refusal is not authenticated, so the pairing is kept and retried; the user decides to pair anew.
  case refused
}

enum PhoneEvent: Sendable {
  case hello(Hello)
  case sessions(RemoteSessionList)
  case prompts([RemotePrompt])
  case feed(FeedUpdate)
}

@MainActor
final class RemoteClient {
  private(set) var pairing: Pairing
  private let onEvent: (PhoneEvent) -> Void
  private let onState: (LinkState) -> Void

  private var socket: Socket?
  private var cipher: FrameCipher?
  private var url = ""
  private var nextId = 1
  private var waiting: [Int: CheckedContinuation<RemoteResult, Never>] = [:]
  private var timers: [Int: Task<Void, Never>] = [:]
  private var stopped = true
  private var connecting = false
  private var retries = 0
  /// When the open link opened: one that held (Link.heldFor) is dialled again at once when it closes.
  private var openedAt: Date?
  private var retryTask: Task<Void, Never>?
  /// Addresses that said they do not know this phone since the last open link: tried last.
  private var refusedBy = Set<String>()
  /// The last state said was `refused`: slow retries do not flash 连接中 in between.
  private var saidRefused = false
  /// Why each address failed on the last attempt that found none (the Mac line's dialog shows it).
  private(set) var lastFailures: [String: String] = [:]
  private var generation = 0

  init(pairing: Pairing, onEvent: @escaping (PhoneEvent) -> Void, onState: @escaping (LinkState) -> Void) {
    self.pairing = pairing
    self.onEvent = onEvent
    self.onState = onState
  }

  var isOpen: Bool { cipher != nil }

  func start() {
    guard stopped else { return }
    stopped = false
    Task { await connect() }
  }

  func stop() {
    stopped = true
    retryTask?.cancel()
    retryTask = nil
    drop()
  }

  /// The Mac reported where it can be reached now; returns the merged list (to keep).
  func setURLs(_ reported: [String]) -> [String] {
    pairing.urls = Link.mergeURLs(reported, current: url.isEmpty ? nil : url, known: pairing.urls)
    return pairing.urls
  }

  /// The app came back to the foreground: reconnect now, or check that the open socket still works.
  func wake() {
    guard !stopped else { return }
    guard isOpen else {
      retryTask?.cancel()
      retryTask = nil
      retries = 0
      Task { await connect() }
      return
    }
    let probed = socket
    Task {
      if await request(.snapshot, timeout: 5).error == "超时" { probed?.close() }
    }
  }

  /// The phone moved to another network (Wi-Fi off, onto cellular and Tailscale): the open socket is bound to the old
  /// one and would only fail when it times out, so drop it and dial every address again now.
  func networkChanged() {
    guard !stopped else { return }
    retryTask?.cancel()
    retryTask = nil
    retries = 0
    if isOpen {
      let at = url
      drop()
      refusedBy.remove(at)
      onState(.connecting)
    }
    Task { await connect() }
  }

  func request(_ command: PhoneCommand, timeout: Double = Link.requestSeconds) async -> RemoteResult {
    guard let socket, var cipher else { return .failed("没有连上 Mac") }
    let id = nextId
    nextId += 1
    var fields = command.fields
    fields["id"] = .number(Double(id))
    let frame = cipher.seal(JSONValue.object(fields).bytes)
    self.cipher = cipher
    return await withCheckedContinuation { done in
      waiting[id] = done
      // Handed to the socket here, on the main actor, in counter order: the Mac drops the link on a frame whose counter
      // went back, so frames must not race each other to the socket.
      socket.send(data: frame) { [weak self] failed in
        Task { @MainActor in
          guard let self, self.waiting[id] != nil else { return }
          if failed {
            self.finish(id, .failed("和 Mac 的连接断了"))
            return
          }
          // The time allowed for the answer starts once the frame is on its way (photos take a while to send).
          self.timers[id] = Task {
            try? await Task.sleep(for: .seconds(timeout))
            if !Task.isCancelled { self.finish(id, .failed("超时")) }
          }
        }
      }
    }
  }

  private func finish(_ id: Int, _ result: RemoteResult) {
    guard let done = waiting.removeValue(forKey: id) else { return }
    timers.removeValue(forKey: id)?.cancel()
    done.resume(returning: result)
  }

  private func drop() {
    generation += 1
    socket?.close()
    socket = nil
    cipher = nil
    for id in Array(waiting.keys) { finish(id, .failed("和 Mac 的连接断了")) }
  }

  private func schedule() {
    guard !stopped, retryTask == nil else { return }
    let delay = Link.retrySeconds[min(retries, Link.retrySeconds.count - 1)]
    retries += 1
    retryTask = Task {
      try? await Task.sleep(for: .seconds(delay))
      guard !Task.isCancelled else { return }
      retryTask = nil
      await connect()
    }
  }

  private func connect() async {
    guard !stopped, !connecting, !isOpen else { return }
    connecting = true
    defer { connecting = false }
    if !saidRefused { onState(.connecting) }
    let untried = pairing.urls.filter { !refusedBy.contains($0) }
    if untried.isEmpty {
      // Every address refused this phone: say so, and keep trying slowly from the top.
      refusedBy.removeAll()
      retries = Link.retrySeconds.count
      saidRefused = true
      onState(.refused)
      schedule()
      return
    }
    var opened: Socket?
    do {
      let socket = try await Link.firstOpen(untried)
      opened = socket
      if stopped {
        socket.close()
        return
      }
      try await socket.send(text: Link.text(["t": "hello", "device": pairing.device]))
      let challenge = try await Link.nextText(socket)
      guard let serverNonce = (challenge["nonce"] as? String).flatMap({ WaviCrypto.fromB64u($0, count: 16) }) else {
        throw Refused(reason: challenge["error"] as? String ?? "")
      }
      guard let secret = WaviCrypto.fromB64u(pairing.secret, count: 32) else { throw Refused(reason: "bad proof") }
      let clientNonce = WaviCrypto.random(16)
      let keys = WaviCrypto.sessionKeys(secret: secret, serverNonce: serverNonce, clientNonce: clientNonce)
      var cipher = FrameCipher(sendKey: keys.fromPhone, receiveKey: keys.toPhone)
      let proof = WaviCrypto.authProof(secret: secret, serverNonce: serverNonce, clientNonce: clientNonce)
      try await socket.send(text: Link.text(["t": "auth", "nonce": WaviCrypto.b64u(clientNonce), "proof": WaviCrypto.b64u(proof)]))
      let hello = try await awaitHello(socket, &cipher)
      if stopped {
        socket.close()
        return
      }
      if let mismatch = Link.protocolMismatch(mac: hello.protocol, phone: Shared.data.protocol) {
        // The two sides would misread each other: say which one to update, and check again slowly.
        socket.close()
        retries = Link.retrySeconds.count
        onState(.offline(mismatch))
        schedule()
        return
      }
      self.socket = socket
      self.cipher = cipher
      url = socket.url
      openedAt = Date()
      refusedBy.removeAll()
      saidRefused = false
      lastFailures = [:]
      generation += 1
      listen(socket, generation)
      onEvent(.hello(hello))
      onState(.open(url: url))
    } catch {
      var reason = OfflineReason.unknown
      if let failed = error as? Link.OpenFailed {
        lastFailures = failed.reasons
        reason = Link.offlineReason(failed.kinds, tailscaleUp: Link.tailscaleUp())
      }
      if let opened, opened !== socket { opened.close() }
      if let refusal = error as? Refused, refusal.isUnknownDevice, let opened {
        refused(opened.url)
        return
      }
      if !saidRefused { onState(.offline(reason)) }
      schedule()
    }
  }

  /// The Mac's first encrypted frame is its hello; a plaintext message here is a refusal.
  private func awaitHello(_ socket: Socket, _ cipher: inout FrameCipher) async throws -> Hello {
    let deadline = Date().addingTimeInterval(Link.replySeconds)
    while true {
      let left = deadline.timeIntervalSinceNow
      guard left > 0 else { throw Timeout() }
      let message: URLSessionWebSocketTask.Message
      do {
        message = try await withTimeout(left, onTimeout: socket.close) { try await socket.receive() }
      } catch {
        throw socket.closeCode == 4001 || socket.closeCode == 4003 ? Refused(reason: "unknown device") : error
      }
      switch message {
      case .string(let text):
        let value = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
        throw Refused(reason: value?["error"] as? String ?? "")
      case .data(let frame):
        guard let plain = cipher.open(frame), let json = try? JSONDecoder().decode(JSONValue.self, from: plain),
          json["event"]?.string == "hello", let hello = json["data"]?.decode(Hello.self)
        else { continue }
        return hello
      @unknown default:
        continue
      }
    }
  }

  private func listen(_ socket: Socket, _ generation: Int) {
    Task {
      while true {
        let message: URLSessionWebSocketTask.Message
        do {
          message = try await socket.receive()
        } catch {
          closed(generation, code: socket.closeCode)
          return
        }
        guard self.generation == generation else { return }
        if !receive(message) {
          // A frame that does not open means the link is broken; start over.
          socket.close()
        }
      }
    }
  }

  private func closed(_ generation: Int, code: Int) {
    guard self.generation == generation, socket != nil else { return }
    let at = url
    drop()
    if code == 4001 || code == 4003 { return refused(at) }
    onState(.connecting)
    // A link that held is dialled again at once: by the time the phone says anything (AppModel waits 2 s), it knows why.
    // One the Mac closes right after opening it waits its turn, with longer waits each time, not a tight loop of pairing
    // proofs.
    if let openedAt, Date().timeIntervalSince(openedAt) >= Link.heldFor {
      retries = 0
      Task { await connect() }
    } else {
      schedule()
    }
  }

  /// `url` said it does not know this phone: try the other addresses at once (another machine may hold that one).
  private func refused(_ url: String) {
    refusedBy.insert(url)
    Task { await connect() }
  }

  private func receive(_ message: URLSessionWebSocketTask.Message) -> Bool {
    guard case .data(let frame) = message, var cipher, let plain = cipher.open(frame),
      let json = try? JSONDecoder().decode(JSONValue.self, from: plain)
    else { return false }
    self.cipher = cipher
    if case .number(let re)? = json["re"] {
      if json["ok"] == .bool(true) { finish(Int(re), .ok(json["data"])) }
      else { finish(Int(re), .failed(json["error"]?.string ?? "没有成功")) }
      return true
    }
    let data = json["data"] ?? .null
    switch json["event"]?.string {
    case "hello": data.decode(Hello.self).map { onEvent(.hello($0)) }
    case "sessions": data.decode(RemoteSessionList.self).map { onEvent(.sessions($0)) }
    case "prompts": data.decode([RemotePrompt].self).map { onEvent(.prompts($0)) }
    case "feed": data.decode(FeedUpdate.self).map { onEvent(.feed($0)) }
    default: break
    }
    return true
  }
}
