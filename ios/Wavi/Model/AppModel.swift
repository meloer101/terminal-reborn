// The phone's state (PRD F22): the pairing (Keychain), the link to the Mac, and what it last said — sessions, prompts
// and the conversation of the session on screen. Views read it from the environment and talk to the Mac with `call`.
import Foundation
import Network
import Observation
import UIKit

@MainActor
@Observable
final class AppModel {
  struct Conversation: Sendable {
    var feed: Feed
    var total: Int
    var loading: Bool
  }

  private(set) var pairing: Pairing?
  private(set) var link: LinkState = .offline
  private(set) var macName = ""
  private(set) var sessions = RemoteSessionList.empty
  private(set) var prompts: [RemotePrompt] = []
  /// The session on screen and its conversation.
  private(set) var watching: String?
  private(set) var conversation: Conversation?
  /// Messages sent from this phone that the session's transcript has not shown yet (the agent writes a message there
  /// only once it takes it): drawn at the end of the conversation at once, gone when the transcript has them.
  private(set) var sending: [String: [ChatItem]] = [:]

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
    link = .offline
    sessions = .empty
    prompts = []
    watching = nil
    conversation = nil
  }

  /// The Mac's addresses and, while it cannot be reached, why each one failed last time.
  var addresses: [(url: String, failure: String?)] {
    let failures = client?.lastFailures ?? [:]
    return (client?.pairing.urls ?? pairing?.urls ?? []).map { ($0, failures[$0]) }
  }

  /// The app came back to the foreground.
  func wake() { client?.wake() }

  func call(_ command: PhoneCommand) async -> RemoteResult {
    await client?.request(command) ?? .failed("没有连上 Mac")
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

  func refresh() async {
    guard let snapshot = await call(.snapshot).decode(Snapshot.self) else { return }
    sessions = RemoteSessionList(projects: snapshot.projects, sessions: snapshot.sessions)
    prompts = snapshot.prompts ?? []
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
    case .prompts(let list):
      prompts = list
    case .feed(let update):
      guard update.session == watching else { return }
      let feed = applyFeed(conversation?.feed, start: update.start, items: update.items, reset: update.reset ?? false)
      conversation = Conversation(feed: feed, total: feed.start + feed.items.count, loading: false)
      arrived(update.session, update.items)
    }
  }

  private func changed(_ state: LinkState) {
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
