// The phone's state (PRD F22): the pairing (Keychain), the link to the Mac, and what it last said — sessions, prompts
// and the conversation of the session on screen. Views read it from the environment and talk to the Mac with `call`.
import Foundation
import Network
import Observation
import UIKit

@MainActor
@Observable
final class AppModel {
  /// The one the app shows, and the one a Live Activity button reaches when the system wakes the app for it.
  static let shared = AppModel()

  struct Conversation: Sendable {
    var feed: Feed
    var total: Int
    var loading: Bool
  }

  private(set) var pairing: Pairing?
  private(set) var link: LinkState = .offline(.unknown)
  /// A link that was open went away (the line says 连接断了，正在重连 rather than 正在连接).
  private(set) var dropped = false
  private(set) var macName = ""
  private(set) var sessions = RemoteSessionList.empty
  /// When the Mac last told this phone its sessions (ms): how old the list is once the link drops.
  private(set) var heardAt: Double?
  private(set) var prompts: [RemotePrompt] = []
  /// The session on screen and its conversation.
  private(set) var watching: String?
  private(set) var conversation: Conversation?
  /// Messages sent from this phone that the session's transcript has not shown yet (the agent writes a message there
  /// only once it takes it): drawn at the end of the conversation at once, gone when the transcript has them.
  private(set) var sending: [String: [ChatItem]] = [:]
  /// Answers given while this phone was connected, per session: left in the conversation where they happened.
  private(set) var receipts: [String: [Receipt]] = [:]
  /// The prompts as last listed, and the ones this phone answered (so a prompt that leaves without it was answered on the
  /// Mac).
  @ObservationIgnored private var listed: [String: RemotePrompt] = [:]
  @ObservationIgnored private var answeredHere: Set<String> = []

  /// Answers `prompt` from this phone (the app or the Live Activity). Marked as answered here before the request: the Mac
  /// lists the prompts again as soon as it takes the answer, and that list may arrive before the reply.
  func answer(_ prompt: RemotePrompt, _ command: PhoneCommand) async -> RemoteResult {
    answeredHere.insert(prompt.id)
    let result = await call(command)
    if result.error != nil { answeredHere.remove(prompt.id) } else { answered(prompt, decision: command.decision) }
    return result
  }

  private func answered(_ prompt: RemotePrompt, decision: String?) {
    addReceipt(prompt, onPhone: true, decision: decision)
  }

  /// One receipt per prompt: a later one replaces it.
  private func addReceipt(_ prompt: RemotePrompt, onPhone: Bool, decision: String?) {
    let receipt = Receipt(id: "receipt-\(prompt.id)", at: Date().timeIntervalSince1970 * 1000, onPhone: onPhone,
      text: receiptText(prompt, decision: decision, onPhone: onPhone))
    receipts[prompt.sessionId, default: []].removeAll { $0.id == receipt.id }
    receipts[prompt.sessionId, default: []].append(receipt)
  }

  /// A new list of prompts: the ones that left without an answer from here were answered on the Mac.
  private func promptsListed(_ list: [RemotePrompt]) {
    let ids = Set(list.map(\.id))
    for (id, prompt) in listed where !ids.contains(id) && !answeredHere.contains(id) {
      addReceipt(prompt, onPhone: false, decision: nil)
    }
    answeredHere.formIntersection(ids)
    listed = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    prompts = list
  }

  /// Sent from the composer: on screen now, before the Mac answers.
  func willSend(_ session: String, text: String, photos: Int) -> String {
    let id = "sending-\(UUID().uuidString)"
    sending[session, default: []].append(ChatItem(kind: "user", id: id, at: Date().timeIntervalSince1970 * 1000, text: text, images: photos))
    return id
  }

  /// The Mac refused it: it was never sent.
  func failedToSend(_ session: String, id: String) {
    sending[session]?.removeAll { $0.id == id }
  }

  /// The transcript caught up: each user message in it takes the oldest of this session's messages still sending.
  private func arrived(_ session: String, _ items: [ChatItem]) {
    guard var waiting = sending[session], !waiting.isEmpty else { return }
    for item in items where item.kind == "user" {
      guard let first = waiting.first, item.at >= first.at - 5000 else { continue }
      waiting.removeFirst()
    }
    sending[session] = waiting
  }

  /// A session to open as soon as the list has it (one just created from the phone).
  var opening: String?
  /// Bumped to go back to the session list (its worktree was archived).
  private(set) var backToList = 0

  func showList() { backToList += 1 }

  @ObservationIgnored private var client: RemoteClient?
  @ObservationIgnored private let activities = LiveActivities()
  /// An answer from the island that did not reach the Mac, shown on the card until that prompt goes.
  @ObservationIgnored private var activityFailure: (prompt: String, text: String)?
  /// A snapshot came since launch (sessions and prompts together); before that (the system just woke the app for a
  /// button) the empty lists would end the Live Activity.
  @ObservationIgnored private var loaded = false
  /// The prompts Wavi has listed, so only a new one lights the island up.
  @ObservationIgnored private var knownPrompts: Set<String> = []

  @ObservationIgnored private let paths = NWPathMonitor()
  @ObservationIgnored private var lastPath: String?

  init() {
    pairing = PairingStore.load()
    macName = pairing?.macName ?? ""
    if let pairing { connect(pairing) }
    // Wi-Fi ↔ cellular (and Tailscale coming up) changes which of the Mac's addresses can be reached.
    paths.pathUpdateHandler = { [weak self] path in
      let key = "\(path.status == .satisfied) \(path.availableInterfaces.map(\.name).joined(separator: ","))"
      Task { @MainActor in self?.pathChanged(key) }
    }
    paths.start(queue: .main)
  }

  private func pathChanged(_ key: String) {
    defer { lastPath = key }
    guard let lastPath, lastPath != key else { return }
    client?.networkChanged()
  }

  var isOpen: Bool { if case .open = link { return true } else { return false } }

  /// What the connection line under the titles says.
  var connection: ConnectionWords { connectionWords(link, mac: macName, dropped: dropped) }


  func session(_ id: String) -> RemoteSession? { sessions.sessions.first { $0.id == id } }

  /// Just paired.
  func adopt(_ pairing: Pairing) {
    PairingStore.save(pairing)
    self.pairing = pairing
    macName = pairing.macName
    connect(pairing)
  }

  /// 取消配对 (also how a phone the Mac no longer knows starts over).
  func forget() {
    client?.stop()
    client = nil
    clientToken = UUID()
    PairingStore.clear()
    pairing = nil
    link = .offline(.unknown)
    dropped = false
    sessions = .empty
    heardAt = nil
    prompts = []
    receipts = [:]
    listed = [:]
    answeredHere = []
    watching = nil
    conversation = nil
    loaded = false
    knownPrompts = []
    activityFailure = nil
    syncActivity()
  }

  /// The Mac's addresses and, while it cannot be reached, why each one failed last time.
  var addresses: [(url: String, failure: String?)] {
    let failures = client?.lastFailures ?? [:]
    return (client?.pairing.urls ?? pairing?.urls ?? []).map { ($0, failures[$0]) }
  }

  /// The app came back to the foreground: check the link, and start the Live Activity if the background could not.
  func wake() {
    // 重试 says it is trying (the retries in between keep the reason on screen).
    if case .offline = link { link = .connecting }
    client?.wake()
    syncActivity()
  }

  func call(_ command: PhoneCommand) async -> RemoteResult {
    await client?.request(command) ?? .failed("没有连上 Mac")
  }

  /// The link is open, or opened within `seconds` (the app was just woken in the background).
  func whenOpen(seconds: Double = 8) async -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while !isOpen {
      guard client != nil, Date() < deadline else { return false }
      try? await Task.sleep(for: .milliseconds(200))
    }
    return true
  }

  /// The Live Activity follows the sessions and prompts; `alert` when Wavi just listed a prompt it had not before.
  @discardableResult
  private func syncActivity(alert: Bool = false) -> Task<Void, Never>? {
    guard pairing != nil else { return activities.show(nil, mac: macName) }
    // Nothing heard yet: keep the card as it is, only saying why an answer from it failed.
    guard loaded else {
      guard let failure = activityFailure, var shown = activities.current, shown.prompt == failure.prompt else { return nil }
      shown.failure = failure.text
      return activities.show(shown, mac: macName)
    }
    var state = activityState(sessions: sessions.sessions, prompts: prompts, now: Date().timeIntervalSince1970 * 1000, mac: macName)
    if let failure = activityFailure {
      if state?.prompt == failure.prompt { state?.failure = failure.text } else { activityFailure = nil }
    }
    return activities.show(state, mac: macName, alert: alert)
  }

  /// A button on the island or the Lock Screen (in this process, maybe just woken for it): the link is checked (a
  /// socket from before the app was suspended may be dead without knowing it) and the list fetched, then the answer
  /// sent; the prompt goes at once (Wavi's list follows), or the card says why it did not.
  func answerFromActivity(prompt: String, command: PhoneCommand) async {
    var result = RemoteResult.failed("没有连上 Mac")
    var target: RemotePrompt?
    if await whenOpen() {
      if !(await refresh(timeout: 4)) {
        client?.networkChanged()
        if await whenOpen() { await refresh(timeout: 4) }
      }
      if isOpen {
        // Taken before the request: the Mac's next list (it may come before the reply) no longer has it.
        target = prompts.first { $0.id == prompt }
        answeredHere.insert(prompt)
        result = await client?.request(command, timeout: 10) ?? result
      }
    }
    if let failure = result.error {
      answeredHere.remove(prompt)
      activityFailure = (prompt, String(failure.prefix(80)))
    } else {
      if let target { answered(target, decision: command.decision) }
      prompts.removeAll { $0.id == prompt }
      knownPrompts.remove(prompt)
    }
    await syncActivity()?.value
  }

  /// The session on screen (nil: back at the list): its newest page, then what is appended.
  func watch(_ session: String?) async {
    if watching != session {
      watching = session
      conversation = session == nil ? nil : Conversation(feed: Feed(start: 0, items: []), total: 0, loading: true)
    }
    let result = await call(.watch(session: session))
    guard let session, watching == session else { return }
    if let page = result.decode(Page.self) {
      conversation = Conversation(feed: Feed(start: page.start, items: page.items), total: page.total, loading: false)
      arrived(session, page.items)
    } else {
      conversation?.loading = false
    }
  }

  /// The page before what is on screen (scrolled to the top).
  func loadOlder() async {
    guard let session = watching, let now = conversation, !now.loading, now.feed.start > 0 else { return }
    conversation?.loading = true
    let result = await call(.feed(session: session, before: now.feed.start))
    guard watching == session, var current = conversation else { return }
    if let page = result.decode(Page.self) { current.feed = prependFeed(current.feed, start: page.start, items: page.items) }
    current.loading = false
    conversation = current
  }

  private struct Page: Decodable {
    let items: [ChatItem]
    let start: Int
    let total: Int
  }

  private struct Snapshot: Decodable {
    let projects: [RemoteProject]
    let sessions: [RemoteSession]
    let prompts: [RemotePrompt]?
  }

  @discardableResult
  func refresh(timeout: Double = Link.requestSeconds) async -> Bool {
    guard let snapshot = await client?.request(.snapshot, timeout: timeout).decode(Snapshot.self) else { return false }
    sessions = RemoteSessionList(projects: snapshot.projects, sessions: snapshot.sessions)
    heardAt = Date().timeIntervalSince1970 * 1000
    promptsListed(snapshot.prompts ?? [])
    knownPrompts = Set(prompts.map(\.id))
    loaded = true
    syncActivity()
    return true
  }

  @ObservationIgnored private var clientToken = UUID()

  private func connect(_ pairing: Pairing) {
    client?.stop()
    // A replaced client may still finish a handshake: whatever it says no longer counts.
    let token = UUID()
    clientToken = token
    let client = RemoteClient(
      pairing: pairing,
      onEvent: { [weak self] event in if self?.clientToken == token { self?.handle(event) } },
      onState: { [weak self] state in if self?.clientToken == token { self?.changed(state) } }
    )
    self.client = client
    client.start()
  }

  private func handle(_ event: PhoneEvent) {
    switch event {
    case .hello(let hello):
      macName = hello.name
      guard let pairing, let client else { return }
      let merged = client.setURLs(hello.urls ?? [])
      if merged != pairing.urls || pairing.macName != hello.name {
        let next = Pairing(device: pairing.device, secret: pairing.secret, macName: hello.name, urls: merged)
        self.pairing = next
        PairingStore.save(next)
      }
    case .sessions(let list):
      sessions = list
      heardAt = Date().timeIntervalSince1970 * 1000
      syncActivity()
    case .prompts(let list):
      promptsListed(list)
      let ids = Set(list.map(\.id))
      let fresh = !ids.subtracting(knownPrompts).isEmpty
      knownPrompts = ids
      syncActivity(alert: fresh)
    case .feed(let update):
      guard update.session == watching else { return }
      let feed = applyFeed(conversation?.feed, start: update.start, items: update.items, reset: update.reset ?? false)
      conversation = Conversation(feed: feed, total: feed.start + feed.items.count, loading: false)
      arrived(update.session, update.items)
    }
  }

  /// A drop shows only after this: a link back within it never flashes a notice.
  @ObservationIgnored private var grace: Task<Void, Never>?
  @ObservationIgnored private var pendingLink: LinkState?

  private func changed(_ state: LinkState) {
    if case .open = state {
      grace?.cancel()
      grace = nil
      dropped = false
    } else {
      // While it cannot connect, a retry does not flash 正在连接 over the reason.
      if case .connecting = state, case .offline = link { return }
      if grace != nil || isOpen {
        pendingLink = state
        guard grace == nil else { return }
        grace = Task {
          try? await Task.sleep(for: .seconds(2))
          guard !Task.isCancelled, let pending = pendingLink else { return }
          dropped = true
          link = pending
          grace = nil
        }
        return
      }
    }
    link = state
    guard case .open = state else { return }
    Task {
      await refresh()
      // Wavi keeps who watches what per connection: a new one has to say it again.
      if let watching { await watch(watching) }
    }
  }

  /// What the Mac lists this phone as (设置 · 手机).
  static var phoneName: String { UIDevice.current.name }
}
