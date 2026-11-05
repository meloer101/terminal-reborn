// Wavi on the iPhone (PRD F22): the sessions running in Wavi on the Mac, to follow, answer and steer from wherever the
// Mac can be reached (the same Wi-Fi or Tailscale).
import SwiftUI

@main
struct WaviApp: App {
  @State private var model = AppModel.shared
  @Environment(\.scenePhase) private var phase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .tint(Color.textPrimary)
    }
    .onChange(of: phase) { _, phase in
      // A backgrounded app's socket may have died while it was frozen: reconnect, or check the open one.
      if phase == .active { model.wake() }
    }
  }
}

enum Route: Hashable {
  case session(String)
  case changes(String)
  case tool(session: String, item: String)
  case diff(session: String, path: String, scope: String, oldPath: String?, untracked: Bool)
}

/// Not paired: pairing. Else the sessions, and whatever was opened from them.
struct RootView: View {
  @Environment(AppModel.self) private var model
  @State private var path: [Route] = []
  /// A `wavi://pair` link opened from elsewhere (the Camera app, a message): confirmed before it pairs.
  @State private var linked: PairingOffer?

  var body: some View {
    Group {
      if model.pairing == nil {
        PairView(offer: $linked)
      } else {
        NavigationStack(path: $path) {
          SessionsView()
            .navigationDestination(for: Route.self) { route in
              switch route {
              case .session(let id): SessionView(id: id)
              case .changes(let id): ChangesView(id: id)
              case .tool(let session, let item): ToolView(session: session, item: item)
              case .diff(let session, let file, let scope, let oldPath, let untracked):
                FileDiffView(session: session, path: file, scope: scope, oldPath: oldPath, untracked: untracked)
              }
            }
        }
        .sheet(item: $linked) { _ in PairView(offer: $linked, replacing: model.pairing?.macName) }
      }
    }
    .onOpenURL { url in
      // A tap on the Live Activity: its session, or the list.
      if let session = ActivityLink.session(in: url) {
        path = session.map { [.session($0)] } ?? []
      } else {
        linked = Link.parseOffer(url.absoluteString)
      }
    }
    .onChange(of: model.pairing == nil) { path = [] }
    .onChange(of: model.backToList) { path = [] }
    .onChange(of: path) { _, path in
      let open = path.compactMap { if case .session(let id) = $0 { id } else { nil } }.last
      if let watching = model.watching, open != watching { Task { await model.watch(open) } }
    }
    // The new session shows up in the list Wavi pushes a moment after it is made.
    .onChange(of: model.opening.flatMap { model.session($0) }?.id) { _, id in
      guard let id else { return }
      model.opening = nil
      path.append(.session(id))
    }
  }
}

extension PairingOffer: Identifiable {
  var id: String { code }
}
