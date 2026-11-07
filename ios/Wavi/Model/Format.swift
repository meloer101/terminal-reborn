// What the screens show, derived from what Wavi sends (PRD F22): a session's conversation kept in step with the pages
// and pushes of src/main/remote/feed.ts, the session list's groups (Figma 45B), diff rows, short times and the
// permission sheet's words. Pure; WaviTests/FormatTests.swift.
import Foundation

/// The part of a session's conversation the phone has: items `start` … `start + items.count - 1`.
struct Feed: Equatable, Sendable {
  var start: Int
  var items: [ChatItem]
}

/// A page from `watch` / `feed`, or a push: replaces, extends or rewrites the end of what the phone has.
func applyFeed(_ feed: Feed?, start: Int, items: [ChatItem], reset: Bool = false) -> Feed {
  guard let feed, !reset else { return Feed(start: start, items: items) }
  let end = feed.start + feed.items.count
  // A gap (the phone missed pushes) or something before what it has: take the update as the new truth.
  if start > end || start < feed.start { return Feed(start: start, items: items) }
  return Feed(start: feed.start, items: Array(feed.items.prefix(start - feed.start)) + items)
}

/// An older page (ending where the feed starts) goes in front.
func prependFeed(_ feed: Feed, start: Int, items: [ChatItem]) -> Feed {
  guard start + items.count == feed.start else { return feed }
  return Feed(start: start, items: items + feed.items)
}

struct SessionGroup: Identifiable, Sendable {
  struct Row: Identifiable, Sendable {
    let session: RemoteSession
    /// Only in 等你处理, where rows of several projects mix.
    let projectName: String?
    var id: String { session.id }
  }
  /// 等你处理's group (rows of several projects, its count in the attention colour).
  static let needsYouId = "waiting"
  let id: String
  let title: String
  let rows: [Row]
}

/// 等你处理 first (with each row's project), then one group per project in the window's order; newest first (45B).
func groupSessions(_ list: RemoteSessionList) -> [SessionGroup] {
  let names = Dictionary(list.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
  let waiting = list.sessions.filter { $0.status == .needsYou }.sorted { ($0.since ?? $0.activity) > ($1.since ?? $1.activity) }
  var groups: [SessionGroup] = []
  if !waiting.isEmpty {
    groups.append(SessionGroup(id: SessionGroup.needsYouId, title: "等你处理", rows: waiting.map { .init(session: $0, projectName: names[$0.projectId]) }))
  }
  for project in list.projects {
    let rows = list.sessions.filter { $0.projectId == project.id && $0.status != .needsYou }.sorted { $0.activity > $1.activity }
    if !rows.isEmpty { groups.append(SessionGroup(id: project.id, title: project.name, rows: rows.map { .init(session: $0, projectName: nil) })) }
  }
  return groups
}

/// `45s` / `3m` / `2h` / `4d`.
func shortAge(_ ms: Double) -> String {
  let s = max(0, Int(ms / 1000))
  if s < 60 { return "\(s)s" }
  if s < 3600 { return "\(s / 60)m" }
  if s < 86400 { return "\(s / 3600)h" }
  return "\(s / 86400)d"
}

/// The notice over a list that is not live (Figma 62B): how old what it shows is. Nothing heard yet: no age to give.
func staleNotice(heardAt: Double?, now: Double) -> String {
  guard let heardAt else { return "显示的不是最新的状态" }
  let minutes = Int(max(0, now - heardAt) / 60000)
  if minutes < 1 { return "显示的是 1 分钟内的状态" }
  if minutes < 60 { return "显示的是 \(minutes) 分钟前的状态" }
  return "显示的是 \(minutes / 60) 小时前的状态"
}

/// The right-hand time of a session row: how long it has waited, or how long since it last did something.
func rowTime(_ session: RemoteSession, now: Double) -> String {
  if session.status == .needsYou { return "已等 \(shortAge(now - (session.since ?? session.activity)))" }
  return shortAge(now - session.activity)
}

enum DiffRow: Equatable, Sendable {
  case hunk(String)
  case line(sign: Character, old: Int?, new: Int?, code: String)
}

/// Hunks (Edit / Write `structuredPatch`) → numbered rows, as 45D draws them.
func hunkRows(_ hunks: [DiffHunk]) -> [DiffRow] {
  var rows: [DiffRow] = []
  for hunk in hunks {
    let oldCount = hunk.lines.filter { !$0.hasPrefix("+") }.count
    let newCount = hunk.lines.filter { !$0.hasPrefix("-") }.count
    rows.append(.hunk("@@ -\(hunk.oldStart),\(oldCount) +\(hunk.newStart),\(newCount) @@"))
    var o = hunk.oldStart
    var n = hunk.newStart
    for line in hunk.lines {
      let code = String(line.dropFirst())
      switch line.first {
      case "+": rows.append(.line(sign: "+", old: nil, new: n, code: code)); n += 1
      case "-": rows.append(.line(sign: "-", old: o, new: nil, code: code)); o += 1
      default: rows.append(.line(sign: " ", old: o, new: n, code: code)); o += 1; n += 1
      }
    }
  }
  return rows
}

/// `git diff` text (a file of Git · 变更) → the same rows; header lines before the first hunk are dropped.
func unifiedRows(_ text: String) -> [DiffRow] {
  var rows: [DiffRow] = []
  var o = 0
  var n = 0
  var inHunk = false
  let head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
  for line in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
    if let m = line.wholeMatch(of: head) {
      o = Int(m.1) ?? 0
      n = Int(m.2) ?? 0
      inHunk = true
      rows.append(.hunk(line))
      continue
    }
    if !inHunk || line.hasPrefix("\\") { continue }
    let code = String(line.dropFirst())
    if line.hasPrefix("+") { rows.append(.line(sign: "+", old: nil, new: n, code: code)); n += 1 }
    else if line.hasPrefix("-") { rows.append(.line(sign: "-", old: o, new: nil, code: code)); o += 1 }
    else if line.hasPrefix(" ") { rows.append(.line(sign: " ", old: o, new: n, code: code)); o += 1; n += 1 }
  }
  return rows
}

/// `src/auth/session.ts` → `session.ts` and `src/auth/`.
func splitPath(_ path: String) -> (name: String, dir: String) {
  guard let slash = path.lastIndex(of: "/") else { return (path, "") }
  return (String(path[path.index(after: slash)...]), String(path[...slash]))
}

/// The last line worth showing under a Bash row (45C: `✓ 12 passed (1.4s)`).
func lastLine(_ output: String?) -> String? {
  (output ?? "").split(separator: "\n").map { String($0).replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) }
    .last { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
}

/// Tailscale's CGNAT range 100.64.0.0/10: how the top of 45B names the way it is connected.
func viaOf(_ url: String) -> String {
  if let m = url.firstMatch(of: /^wss?:\/\/100\.(\d+)\./), let second = Int(m.1), (64...127).contains(second) { return "Tailscale" }
  return "局域网"
}

/// 45E's title: what the agent wants to do.
func permissionTitle(_ tool: String) -> String {
  switch tool {
  case "Bash": return "运行命令"
  case "Edit", "MultiEdit", "Write", "NotebookEdit": return "修改文件"
  case "WebFetch": return "访问网页"
  case "WebSearch": return "搜索网页"
  default: return "使用 \(tool)"
  }
}

/// The line in 45E's command box: the command, the file or the address; the summary otherwise.
func permissionSubject(_ input: [String: JSONValue], summary: String) -> String {
  for key in ["command", "file_path", "notebook_path", "url", "query", "pattern"] {
    if let value = input[key]?.string, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return value }
  }
  return summary
}

/// 总是允许 pnpm add: what the rule the agent offered covers.
func allowAlwaysLabel(_ rules: [PermissionRule]?) -> String {
  guard let rules, let rule = rules.first else { return "总是允许" }
  let what = (rule.content ?? rule.tool).replacingOccurrences(of: ":*", with: "", options: [.anchored, .backwards]).replacingOccurrences(of: "domain:", with: "", options: .anchored)
  return "总是允许 \(what)\(rules.count > 1 ? " 等 \(rules.count) 项" : "")"
}

/// `<prefix>/<adjective>-<noun>` not in `taken` (src/shared/new-session.ts `generateBranchName`, its words from Shared.json).
func generateBranchName(prefix: String, taken: Set<String>) -> String {
  let words = Shared.data.branchWords
  func make(_ suffix: String) -> String {
    let name = "\(words.adjectives.randomElement() ?? "new")-\(words.nouns.randomElement() ?? "branch")\(suffix)"
    return prefix.isEmpty ? name : "\(prefix)/\(name)"
  }
  for _ in 0..<20 {
    let name = make("")
    if !taken.contains(name) { return name }
  }
  for n in 2... {
    let name = make("-\(n)")
    if !taken.contains(name) { return name }
  }
  return make("")
}
