// The Swift protocol types against the Mac's: src/shared/remote-wire-samples.json is written from the Mac's own types
// (src/main/remote/wire-samples.test.ts). Commands must come out exactly as the Mac's samples; events and answers must
// decode with the type the app reads them with and keep every field through a round trip, except the ones listed below
// that the app deliberately does not read. A field the Mac renames or adds to a command, or renames in what it sends,
// fails here.
import Foundation
import Testing
@testable import Wavi

private final class Marker {}

private struct Samples {
  let commands: [String: JSONValue]
  let shipActions: [String: JSONValue]
  let events: [String: JSONValue]
  let results: [String: JSONValue]

  static func load() throws -> Samples {
    let url = try #require(Bundle(for: Marker.self).url(forResource: "remote-wire-samples", withExtension: "json"))
    let root = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    func section(_ key: String) throws -> [String: JSONValue] {
      guard case .object(let o)? = root[key] else { throw Missing(what: key) }
      return o
    }
    return Samples(commands: try section("commands"), shipActions: try section("shipActions"), events: try section("events"), results: try section("results"))
  }
}

private struct Missing: Error, CustomStringConvertible {
  let what: String
  var description: String { "missing \(what)" }
}

private func text(_ v: JSONValue, _ key: String) throws -> String {
  guard let s = v[key]?.string else { throw Missing(what: key) }
  return s
}

private func number(_ v: JSONValue, _ key: String) throws -> Double {
  guard case .number(let n)? = v[key] else { throw Missing(what: key) }
  return n
}

private func decoded<T: Decodable>(_ v: JSONValue?, _ type: T.Type, _ key: String) throws -> T {
  guard let value = v?.decode(T.self) else { throw Missing(what: key) }
  return value
}

// MARK: - Fields the app does not read

// Key paths relative to the sample's payload; `[]` stands for any array element. Each entry is a field the Mac sends
// that the phone deliberately leaves alone. The test also fails when an entry is no longer in the samples or the app
// starts reading it, so this list stays true.
private let chatItemUnread = [
  // Subagent grouping (Figma 59J): the phone draws a subagent's items in line with the session's.
  "parent",
  // A shell call's exit code: the phone shows the tool's state (ok / error) and output.
  "exit",
  // Every file of a multi-file change: the phone draws `diff`, the first file.
  "files",
  // A task list (TodoWrite / plan): the phone shows the tool row only.
  "todos",
]

private func items(_ prefix: String) -> [String] { chatItemUnread.map { "\(prefix)[].\($0)" } }

private let promptUnread = [
  // Directories 总是允许 would add to the session: the phone's prompt sheet shows the rules only.
  "allowAlways.directories",
]

private let gitChangesUnread = [
  // The base's full ref is for main's fileDiff; the phone asks for a diff by scope.
  "baseRef",
  // Untracked files past the cap: the phone lists what it gets.
  "untrackedOmitted",
]

private let newSessionInfoUnread = [
  // Where the Mac puts worktrees, folder names taken there, the .worktreeinclude list and the setup script: the Mac's
  // worktree creation reads them, the phone only picks base, branch and agent.
  "info.worktreesDir",
  "info.takenFolders",
  "info.includeFiles",
  "info.includeCount",
  "info.hasSetup",
  // Which worktree has a branch out: the phone checks a new branch name against the branch names only.
  "info.branches[].worktreePath",
  "info.branches[].inMainCheckout",
]

// MARK: - Key paths

/// Leaf values by key path (`a.b[2].c`); an empty object or array is a leaf of its own.
private func leaves(_ v: JSONValue, _ path: String = "", into out: inout [String: JSONValue]) {
  switch v {
  case .object(let o) where !o.isEmpty:
    for (k, child) in o { leaves(child, path.isEmpty ? k : "\(path).\(k)", into: &out) }
  case .array(let a) where !a.isEmpty:
    for (i, child) in a.enumerated() { leaves(child, "\(path)[\(i)]", into: &out) }
  default:
    out[path] = v
  }
}

private func pattern(of path: String) -> String { path.replacing(/\[\d+\]/, with: "[]") }

private func isIgnored(_ path: String, _ ignored: [String]) -> Bool {
  let p = pattern(of: path)
  return ignored.contains { p == $0 || p.hasPrefix("\($0).") || p.hasPrefix("\($0)[") }
}

/// `sample` decoded as `T` and encoded again keeps every value the sample has, the ignored paths aside.
private func expectRoundTrip<T: Codable>(_ type: T.Type, _ sample: JSONValue?, ignoring ignored: [String] = [], _ name: String) throws {
  let sample = try #require(sample, "\(name): no payload")
  let value: T
  do {
    value = try JSONDecoder().decode(T.self, from: JSONEncoder().encode(sample))
  } catch {
    Issue.record("\(name): does not decode as \(T.self): \(error)")
    return
  }
  let back = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
  var want: [String: JSONValue] = [:]
  var got: [String: JSONValue] = [:]
  leaves(sample, into: &want)
  leaves(back, into: &got)
  var lost: [String] = []
  for (path, expected) in want.sorted(by: { $0.key < $1.key }) where !isIgnored(path, ignored) {
    let have = got[path]
    // A null the Mac sends is an absent optional to Swift.
    if expected == .null, have == nil || have == .null { continue }
    if have != expected { lost.append("\(path): \(expected) → \(have.map { "\($0)" } ?? "missing")") }
  }
  #expect(lost.isEmpty, "\(name) (\(T.self)) loses fields the Mac sends:\n\(lost.joined(separator: "\n"))")
  for entry in ignored {
    #expect(want.keys.contains { isIgnored($0, [entry]) }, "\(name): ignored \(entry) is not in the sample any more")
    #expect(!got.keys.contains { isIgnored($0, [entry]) }, "\(name): the app reads \(entry) now; drop it from the ignore list")
  }
}

// MARK: - Commands

private func shipAction(_ v: JSONValue?) throws -> ShipAction {
  let a = try #require(v, "ship action")
  switch try text(a, "do") {
  case "start": return .start(exit: try text(a, "exit"))
  case "edit": return .edit(try decoded(a["texts"], RemoteShip.Texts.self, "texts"))
  case "submit": return .submit
  case "retry": return .retry
  case "cancel": return .cancel
  case "conflicts": return .conflicts
  case "switch-pr": return .switchPr
  case let other: throw Missing(what: "a ShipAction for \(other)")
  }
}

/// The app's command built from the sample's values; its `fields` must then be the sample itself.
private func command(_ type: String, _ v: JSONValue) throws -> PhoneCommand {
  switch type {
  case "snapshot": return .snapshot
  case "watch": return .watch(session: v["session"]?.string)
  case "feed": return .feed(session: try text(v, "session"), before: Int(try number(v, "before")))
  case "send": return .send(session: try text(v, "session"), text: try text(v, "text"), photos: try decoded(v["photos"], [RemotePhoto].self, "photos"))
  case "interrupt": return .interrupt(session: try text(v, "session"))
  case "permission": return .permission(prompt: try text(v, "prompt"), decision: try text(v, "decision"))
  case "answer": return .answer(prompt: try text(v, "prompt"), answers: try decoded(v["answers"], [String: String].self, "answers"))
  case "new-session-info": return .newSessionInfo(project: try text(v, "project"))
  case "agent-models": return .agentModels(agent: try text(v, "agent"))
  case "new-session":
    return .newSession(project: try text(v, "project"), workdir: try text(v, "workdir"), agent: try text(v, "agent"), base: try text(v, "base"), branch: try text(v, "branch"), prompt: try text(v, "prompt"), model: try text(v, "model"))
  case "changes": return .changes(session: try text(v, "session"))
  case "diff":
    return .diff(session: try text(v, "session"), path: try text(v, "path"), scope: try text(v, "scope"), oldPath: try text(v, "oldPath"), untracked: v["untracked"] == .bool(true))
  case "exits": return .exits(session: try text(v, "session"))
  case "ship": return .ship(session: try text(v, "session"), action: try shipAction(v["action"]))
  case "archive": return .archive(session: try text(v, "session"))
  case "set-setting": return .setSetting(session: try text(v, "session"), kind: try text(v, "kind"), value: try text(v, "value"))
  default: throw Missing(what: "a PhoneCommand for \(type)")
  }
}

@Suite struct WireTests {
  @Test func commandsAreWhatTheMacParses() throws {
    let samples = try Samples.load().commands
    #expect(!samples.isEmpty)
    for (type, sample) in samples.sorted(by: { $0.key < $1.key }) {
      let built: PhoneCommand
      do {
        built = try command(type, sample)
      } catch {
        Issue.record("command \(type): \(error)")
        continue
      }
      #expect(JSONValue.object(built.fields) == sample, "command \(type)")
    }
  }

  @Test func shipActionsAreWhatTheMacParses() throws {
    let samples = try Samples.load().shipActions
    #expect(!samples.isEmpty)
    for (name, sample) in samples.sorted(by: { $0.key < $1.key }) {
      #expect(try shipAction(sample).json == sample, "ship action \(name)")
    }
  }

  /// As RemoteClient.receive reads each event's `data`.
  @Test func eventsDecodeAsTheAppReadsThem() throws {
    let samples = try Samples.load().events
    #expect(!samples.isEmpty)
    for (name, sample) in samples.sorted(by: { $0.key < $1.key }) {
      #expect(sample["event"] == .string(name))
      let data = sample["data"]
      switch name {
      case "hello": try expectRoundTrip(Hello.self, data, "event hello")
      case "sessions": try expectRoundTrip(RemoteSessionList.self, data, "event sessions")
      case "prompts": try expectRoundTrip([RemotePrompt].self, data, ignoring: promptUnread.map { "[].\($0)" }, "event prompts")
      case "feed": try expectRoundTrip(FeedUpdate.self, data, ignoring: items("items"), "event feed")
      default: Issue.record("event \(name): RemoteClient.receive does not read it")
      }
    }
  }

  /// As the screens that ask decode each answer's `data`.
  @Test func answersDecodeAsTheAppReadsThem() throws {
    let samples = try Samples.load().results
    #expect(!samples.isEmpty)
    for (name, data) in samples.sorted(by: { $0.key < $1.key }) {
      let label = "answer to \(name)"
      switch name {
      case "snapshot": try expectRoundTrip(AppModel.Snapshot.self, data, ignoring: promptUnread.map { "prompts[].\($0)" }, label)
      case "watch", "feed": try expectRoundTrip(AppModel.Page.self, data, ignoring: items("items"), label)
      case "new-session-info": try expectRoundTrip(NewSessionView.Info.self, data, ignoring: newSessionInfoUnread, label)
      case "agent-models": try expectRoundTrip(NewSessionView.AgentModels.self, data, label)
      case "new-session": try expectRoundTrip(NewSessionView.Created.self, data, label)
      case "changes": try expectRoundTrip(GitChanges.self, data, ignoring: gitChangesUnread, label)
      case "diff": try expectRoundTrip(FileDiffView.Text_.self, data, label)
      case "exits": try expectRoundTrip(RemoteExits.self, data, label)
      default: Issue.record("\(label): no screen decodes it")
      }
    }
  }
}
