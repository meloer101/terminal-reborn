// Git · 变更 (Figma 45I / 46I): what the session's worktree changed — 未提交 against HEAD, 已提交 against the branch it left
// — each file with its line counts; a file opens its diff. Floating at the bottom, the exits Git · 变更 on the Mac offers
// (PRD F16: 合并到 main 并推送 / 创建 PR / 推送到 PR #N / 打开 PR #N) and 归档 (F15); an exit's progress is a sheet (45J).
import SwiftUI

struct ChangesView: View {
  let id: String
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var data: GitChanges?
  @State private var error: String?
  @State private var exits: RemoteExits?
  @State private var exitsError: String?
  @State private var busy: String?
  @State private var sheet = false
  @State private var archiving = false
  @State private var alert: String?

  private static let prState = ["open": "已打开", "draft": "草稿", "merged": "已合并", "closed": "已关闭"]

  var body: some View {
    let ship = model.session(id)?.ship
    Group {
      if let data {
        list(data)
      } else if let error {
        Text(error).font(.ui(.subheadline)).foregroundStyle(Color.textSecondary).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(20)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).padding(20)
      }
    }
    .background(Color.bgApp)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) {
        VStack(spacing: 2) {
          Text("变更").font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary)
          if let data { Text(subtitle(data)).font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1) }
        }
      }
    }
    .safeAreaBar(edge: .bottom) { footer(ship) }
    .task { await load() }
    // An exit that ends changes what is left to ship: read it all again.
    .onChange(of: ship == nil) { _, ended in if ended { Task { await load() } } }
    .sheet(isPresented: $sheet) { ShipSheet(session: id) }
    .confirmationDialog("归档这个 worktree？", isPresented: $archiving, titleVisibility: .visible) {
      Button("归档", role: .destructive) { Task { await archive() } }
    } message: {
      Text("停止它的 agent，记下工作区，从列表里收起；文件夹留着，可以在 Mac 上恢复。")
    }
    .alert(alert ?? "", isPresented: Binding(get: { alert != nil }, set: { if !$0 { alert = nil } })) {}
  }

  private func list(_ data: GitChanges) -> some View {
    let all = data.uncommitted + data.committed
    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Text("+\(all.reduce(0) { $0 + ($1.added ?? 0) })").font(.mono(.title3)).foregroundStyle(Color.diffAddFg)
          Text("−\(all.reduce(0) { $0 + ($1.removed ?? 0) })").font(.mono(.title3)).foregroundStyle(Color.diffDelFg)
          Text("\(all.count) 个文件").font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 4)
        if all.isEmpty { Text("没有改动").font(.ui(.subheadline)).foregroundStyle(Color.textSecondary).padding(20) }
        if !data.uncommitted.isEmpty {
          GroupHeader(title: "未提交", count: data.uncommitted.count)
          ForEach(data.uncommitted, id: \.path) { file($0, scope: "uncommitted") }
        }
        if !data.committed.isEmpty {
          GroupHeader(title: "已提交 · \(data.ahead) 个提交", count: data.committed.count)
          ForEach(data.committed, id: \.path) { file($0, scope: "committed") }
        }
        if let exits, let pr = prLine(exits) {
          HStack(spacing: 10) {
            Icon("git-pull-request", size: 16)
            Text(pr).font(.ui(.subheadline)).lineLimit(1)
          }
          .foregroundStyle(Color.textSecondary)
          .padding(.horizontal, 20)
          .padding(.top, 16)
        }
      }
      .padding(.bottom, 24)
    }
    .refreshable { await load() }
    .scrollEdgeEffectStyle(.hard, for: .top)
  }

  private func file(_ f: GitFileChange, scope: String) -> some View {
    let (name, dir) = splitPath(f.path)
    let status = f.untracked == true ? "A" : f.status
    let openable = f.nested != true && f.tooLarge != true
    return NavigationLink(value: Route.diff(session: id, path: f.path, scope: scope, oldPath: f.oldPath, untracked: f.untracked == true)) {
      HStack(spacing: 10) {
        Text(status).font(.mono(.caption, medium: true)).foregroundStyle(status == "A" ? Color.diffAddFg : status == "D" ? Color.diffDelFg : Color.textSecondary).frame(width: 10)
        VStack(alignment: .leading, spacing: 2) {
          Text(name).font(.mono(.subheadline)).foregroundStyle(Color.textPrimary).lineLimit(1)
          if !dir.isEmpty { Text(dir).font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1) }
        }
        Spacer(minLength: 0)
        Counts(added: f.added, removed: f.removed)
        if openable { Icon("chevron-right", size: 16).foregroundStyle(Color.textSecondary) }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 12)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowStyle())
    .disabled(!openable)
  }

  @ViewBuilder
  private func footer(_ ship: RemoteShip?) -> some View {
    VStack(spacing: 8) {
      if let ship {
        Button { sheet = true } label: {
          HStack(spacing: 10) {
            StatusGlyph(status: ship.error != nil ? .error : ship.stage == .glance ? .needsYou : .running)
            Text(ship.title).font(.ui(.subheadline)).foregroundStyle(Color.textPrimary).lineLimit(1)
            Spacer(minLength: 0)
            Text(ship.error != nil ? "没有完成" : ship.stage == .glance ? "等你看一眼" : ship.steps.first { $0.state == .working }?.label ?? "")
              .font(.ui(.footnote)).foregroundStyle(ship.error != nil ? Color.statusError : Color.textSecondary).lineLimit(1)
          }
          .padding(.horizontal, 16)
          .frame(minHeight: 52)
          .glass(24, interactive: true)
        }
        .buttonStyle(.plain)
      } else if let exits {
        if let primary = exits.primary { exitButton(primary, primary: true) }
        HStack(spacing: 8) {
          if let secondary = exits.secondary { exitButton(secondary) }
          Button { exits.archive.blocker.map { alert = $0 } ?? (archiving = true) } label: {
            if busy == "archive" { ProgressView() } else { Text("归档") }
          }
          .buttonStyle(.wavi(floating: true))
          .frame(maxWidth: exits.secondary == nil ? .infinity : 80)
          .opacity(exits.archive.blocker == nil ? 1 : 0.4)
        }
      } else if let exitsError {
        Text(exitsError).font(.ui(.subheadline)).foregroundStyle(Color.textSecondary).padding(.vertical, 8)
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 8)
  }

  private func exitButton(_ exit: RemoteExit, primary: Bool = false) -> some View {
    Button { Task { await go(exit) } } label: {
      if busy == exit.kind { ProgressView() } else { Text(exit.label).lineLimit(1) }
    }
    .buttonStyle(.wavi(primary: primary, floating: true))
    .opacity(exit.blocker == nil ? 1 : 0.4)
  }

  private func subtitle(_ d: GitChanges) -> String {
    [d.branch.map { b in d.base.map { "\(b) → \($0)" } ?? b }, d.ahead > 0 ? "领先 \(d.ahead)" : nil, d.behind > 0 ? "落后 \(d.behind)" : nil]
      .compactMap { $0 }.joined(separator: " · ")
  }

  /// 45I's PR line: the branch's PR, or that there is none (and whether the base is protected).
  private func prLine(_ e: RemoteExits) -> String? {
    if let pr = e.pr { return "PR #\(pr.number) · \(Self.prState[pr.state] ?? pr.state)" }
    let offersPr = [e.primary, e.secondary].contains { $0?.kind == "pr" }
    if !offersPr && e.baseProtected == nil { return nil }
    return "还没有 PR\(e.baseProtected == true && e.base != nil ? " · \(e.base!) 有分支保护" : "")"
  }

  private func load() async {
    async let changes = model.call(.changes(session: id))
    async let exitsResult = model.call(.exits(session: id))
    let (c, e) = await (changes, exitsResult)
    if let d = c.decode(GitChanges.self) { data = d; error = nil } else { error = c.error }
    exits = e.decode(RemoteExits.self)
    exitsError = e.error
  }

  private func go(_ exit: RemoteExit) async {
    if let blocker = exit.blocker { alert = blocker; return }
    if exit.kind == "open-pr" {
      if let url = exit.url.flatMap(URL.init(string:)) { openURL(url) }
      return
    }
    busy = exit.kind
    let result = await model.call(.ship(session: id, action: .start(exit: exit.kind)))
    busy = nil
    if let failure = result.error { alert = failure } else { sheet = true }
  }

  private func archive() async {
    busy = "archive"
    let result = await model.call(.archive(session: id))
    busy = nil
    // The session goes with its worktree: back to the list, not to a page about a session that is gone.
    if let failure = result.error { alert = failure } else { model.showList() }
  }
}

/// 出口进度 (Figma 45J / 46J): an exit of Git · 变更 running on the Mac (PRD F16 v1.78) — the agent writes the text, the
/// phone gets a last look and may edit it, then Wavi commits, merges, pushes or opens the PR. 在后台继续 closes the sheet;
/// the run goes on on the Mac.
struct ShipSheet: View {
  let session: String
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var texts: RemoteShip.Texts?
  @State private var seededFor = ""
  @State private var pending = false
  @State private var debounce: Task<Void, Never>?
  @State private var busy: String?
  @State private var error: String?

  var body: some View {
    let ship = model.session(session)?.ship
    FittedSheet {
      VStack(alignment: .leading, spacing: 16) {
        if let ship { running(ship) } else { finished }
      }
    }
    .onChange(of: ship, initial: true) { _, ship in seed(ship) }
  }

  private func editable(_ ship: RemoteShip) -> Bool { (ship.stage == .glance || ship.error != nil) && !ship.fields.isEmpty }

  /// The fields start from what the agent wrote each time the run reaches a new stage (or fails); while they can be
  /// edited, later pushes (the echo of what is being typed) do not overwrite them.
  private func seed(_ ship: RemoteShip?) {
    guard let ship else {
      seededFor = ""
      texts = nil
      return
    }
    let key = "\(ship.stage.rawValue):\(ship.error?.step ?? "")"
    if !editable(ship) || seededFor != key {
      seededFor = key
      texts = ship.texts
    }
  }

  @ViewBuilder
  private func running(_ ship: RemoteShip) -> some View {
    Text(ship.title).font(.ui(.title3)).foregroundStyle(Color.textPrimary)
    if let texts, editable(ship) || ship.stage == .running,
      ship.fields.contains(where: { $0 != "draft" && !(value(texts, $0)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
      ForEach(ship.fields.filter { $0 != "draft" }, id: \.self) { field in
        VStack(alignment: .leading, spacing: 8) {
          if ship.fields.count > 1 { Text(["commit": "提交说明", "title": "标题", "body": "正文"][field] ?? field).font(.ui(.footnote, medium: true)).foregroundStyle(Color.textSecondary) }
          TextField("", text: binding(field), axis: field == "title" ? .horizontal : .vertical)
            .font(.mono(field == "body" ? .caption : .footnote))
            .lineLimit(field == "title" ? 1...1 : 1...10)
            .disabled(!editable(ship))
            .foregroundStyle(Color.textPrimary)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: 10))
        }
      }
      if ship.fields.contains("draft") && editable(ship) {
        Button { edit { $0.draft.toggle() } } label: {
          HStack(spacing: 10) {
            Icon(texts.draft ? "square-check" : "square", size: 20)
            Text("草稿").font(.ui(.subheadline))
          }
          .foregroundStyle(Color.textPrimary)
        }
        .buttonStyle(.plain)
      }
    }
    VStack(alignment: .leading, spacing: 12) {
      ForEach(ship.steps) { step in
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 10) {
            StatusGlyph(status: step.state == .working ? .running : step.state == .done ? .doneUnread : step.state == .failed ? .error : .idle)
            Text(step.label).font(.ui(.subheadline)).foregroundStyle(step.state == .pending ? Color.textSecondary : Color.textPrimary).lineLimit(1)
            Spacer(minLength: 0)
            if let note = step.note { Text(note).font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1) }
          }
          if let failure = ship.error, failure.step == step.id {
            VStack(alignment: .leading, spacing: 8) {
              Text(failure.message).font(.ui(.subheadline)).foregroundStyle(Color.statusError)
              if let output = failure.output {
                Text(output).font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(8).padding(12).background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: 8))
              }
            }
            .padding(.leading, 24)
          }
        }
      }
    }
    if let error { Text(error).font(.ui(.subheadline)).foregroundStyle(Color.statusError) }
    if let failure = ship.error {
      action("重试", "retry", .retry, primary: true)
      if failure.conflicts { action("交给 \(ship.agent) 解", "conflicts", .conflicts) }
      if failure.pushRefused { action("改为创建 PR", "switch", .switchPr) }
      action("取消", "cancel", .cancel)
    } else if ship.stage == .glance {
      HStack(spacing: 10) {
        action("取消", "cancel", .cancel).frame(maxWidth: 120)
        action(ship.submitLabel, "submit", .submit, primary: true)
      }
    } else if ship.stage == .writing {
      HStack(spacing: 10) {
        action("取消", "cancel", .cancel).frame(maxWidth: 120)
        Button("在后台继续") { close() }.buttonStyle(.wavi)
      }
    } else {
      Button("在后台继续") { close() }.buttonStyle(.wavi)
    }
  }

  @ViewBuilder
  private var finished: some View {
    HStack(spacing: 10) {
      StatusGlyph(status: model.session(session)?.shipNotice != nil ? .doneUnread : .idle)
      Text(model.session(session)?.shipNotice ?? "这个出口已经结束了").font(.ui(.subheadline)).foregroundStyle(Color.textPrimary)
    }
    Button("完成") { dismiss() }.buttonStyle(.wavi(primary: true))
  }

  private func value(_ t: RemoteShip.Texts, _ field: String) -> String {
    field == "commit" ? t.commit : field == "title" ? t.title : t.body
  }

  private func binding(_ field: String) -> Binding<String> {
    Binding(get: { texts.map { value($0, field) } ?? "" }, set: { new in
      edit { t in
        if field == "commit" { t.commit = new } else if field == "title" { t.title = new } else { t.body = new }
      }
    })
  }

  /// Edits reach the Mac 400 ms after the last keystroke (and at once before going ahead).
  private func edit(_ change: (inout RemoteShip.Texts) -> Void) {
    guard var t = texts else { return }
    change(&t)
    texts = t
    pending = true
    debounce?.cancel()
    debounce = Task {
      try? await Task.sleep(for: .milliseconds(400))
      if !Task.isCancelled { _ = await flush() }
    }
  }

  private func flush() async -> Bool {
    debounce?.cancel()
    guard pending, let texts else { return true }
    pending = false
    let result = await model.call(.ship(session: session, action: .edit(texts)))
    if let failure = result.error { error = failure }
    return result.error == nil
  }

  private func action(_ label: String, _ key: String, _ action: ShipAction, primary: Bool = false) -> some View {
    Button {
      busy = key
      error = nil
      Task {
        // Cancelling drops the text anyway; anything else goes with the latest edit.
        if key != "cancel", !(await flush()) {
          busy = nil
          return
        }
        let result = await model.call(.ship(session: session, action: action))
        busy = nil
        if let failure = result.error { error = failure } else if key == "cancel" { dismiss() }
      }
    } label: {
      if busy == key { ProgressView() } else { Text(label).lineLimit(1) }
    }
    .buttonStyle(.wavi(primary: primary))
    .disabled(busy != nil)
  }

  private func close() {
    Task { _ = await flush() }
    dismiss()
  }
}
