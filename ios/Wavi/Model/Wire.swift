// What the phone and Wavi say to each other (PRD F22): the Swift side of src/shared/remote.ts and the shared types it
// uses (transcript-chat ChatItem, agent-events PendingPrompt, git-graph GitChanges, new-session NewSessionInfo). Field
// names are the JSON's; anything the Mac adds later is ignored, an unknown status reads as idle.
import Foundation

enum SessionStatus: String, Codable, Hashable, Sendable {
  case running, needsYou = "needs_you", doneUnread = "done_unread", idle, error, exited

  init(from decoder: Decoder) throws {
    self = SessionStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .idle
  }

  var label: String { Shared.data.statusLabel[rawValue] ?? rawValue }
}

struct RemoteProject: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let name: String
}

struct RemoteShip: Codable, Hashable, Sendable {
  enum Stage: String, Codable, Sendable { case writing, glance, running }
  enum StepState: String, Codable, Sendable { case pending, working, done, failed }
  struct Step: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let state: StepState
    let note: String?
  }
  struct Texts: Codable, Hashable, Sendable {
    var commit: String
    var title: String
    var body: String
    var draft: Bool
  }
  struct Failure: Codable, Hashable, Sendable {
    let step: String
    let message: String
    let output: String?
    let conflicts: Bool
    let pushRefused: Bool
  }
  let kind: String
  let title: String
  let agent: String
  let stage: Stage
  let steps: [Step]
  let texts: Texts
  /// The glance's editable fields, top to bottom: commit / title / body / draft.
  let fields: [String]
  let submitLabel: String
  let submitBlocker: String?
  let error: Failure?
}

struct RemoteSession: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let projectId: String
  let title: String
  let agent: String
  let status: SessionStatus
  let action: String?
  /// Epoch ms the status began.
  let since: Double?
  let activity: Double
  let branch: String?
  let model: String?
  let reply: String?
  let ship: RemoteShip?
  let shipNotice: String?
}

struct RemoteSessionList: Codable, Hashable, Sendable {
  var projects: [RemoteProject]
  var sessions: [RemoteSession]
  static let empty = RemoteSessionList(projects: [], sessions: [])
}

struct RemoteExit: Codable, Hashable, Sendable {
  /// main / pr / push-pr / open-pr
  let kind: String
  let label: String
  let blocker: String?
  let url: String?
}

struct RemoteExits: Codable, Hashable, Sendable {
  struct PR: Codable, Hashable, Sendable {
    let number: Int
    let state: String
    let url: String
  }
  struct Archive: Codable, Hashable, Sendable { let blocker: String? }
  let primary: RemoteExit?
  let secondary: RemoteExit?
  let pr: PR?
  let base: String?
  let baseProtected: Bool?
  let archive: Archive
}

struct DiffHunk: Codable, Hashable, Sendable {
  let oldStart: Int
  let newStart: Int
  let lines: [String]
}

struct ToolDiff: Codable, Hashable, Sendable {
  let path: String
  let hunks: [DiffHunk]
  let added: Int
  let removed: Int
  let truncated: Bool
}

/// One item of a session's conversation (transcript-chat.ts): `kind` is user / text / thinking / tool / system / unknown.
struct ChatItem: Codable, Hashable, Sendable, Identifiable {
  let kind: String
  let id: String
  let at: Double
  var text: String? = nil
  var images: Int? = nil
  var ms: Double? = nil
  var name: String? = nil
  var arg: String? = nil
  /// running / ok / error
  var state: String? = nil
  var output: String? = nil
  var diff: ToolDiff? = nil
  var type: String? = nil
}

struct PermissionRule: Codable, Hashable, Sendable {
  let tool: String
  let content: String?
}

struct AllowAlwaysScope: Codable, Hashable, Sendable {
  let scope: String
  let rules: [PermissionRule]
}

struct QuestionOption: Codable, Hashable, Sendable {
  let label: String
  let description: String?
}

struct AgentQuestion: Codable, Hashable, Sendable {
  let header: String?
  let question: String
  let multiSelect: Bool
  let options: [QuestionOption]
}

/// A permission request or an AskUserQuestion the agent waits on; `answerable` while an answer from the phone reaches it.
struct RemotePrompt: Codable, Hashable, Sendable, Identifiable {
  /// permission / question
  let kind: String
  let id: String
  let sessionId: String
  let createdAt: Double
  let answerable: Bool
  var tool: String? = nil
  var input: [String: JSONValue]? = nil
  var summary: String? = nil
  var canAllowAlways: Bool? = nil
  var allowAlways: AllowAlwaysScope? = nil
  var questions: [AgentQuestion]? = nil
}

struct GitFileChange: Codable, Hashable, Sendable {
  let path: String
  let oldPath: String?
  /// M / A / D / R / C / U / T
  let status: String
  let added: Int?
  let removed: Int?
  let untracked: Bool?
  let nested: Bool?
  let tooLarge: Bool?
}

struct GitChanges: Codable, Hashable, Sendable {
  let branch: String?
  let base: String?
  let ahead: Int
  let behind: Int
  let uncommitted: [GitFileChange]
  let committed: [GitFileChange]
}

struct NewSessionBranch: Codable, Hashable, Sendable {
  let name: String
  let remote: Bool
}

struct NewSessionInfo: Codable, Hashable, Sendable {
  let repo: Bool
  let currentBranch: String?
  let defaultBranch: String?
  let branches: [NewSessionBranch]
  let prefix: String
}

struct Hello: Codable, Sendable {
  let name: String
  let version: String
  /// REMOTE_PROTOCOL; absent from a Mac before it (that Mac speaks 1).
  let `protocol`: Int?
  let urls: [String]?
}

struct FeedUpdate: Codable, Sendable {
  let session: String
  let items: [ChatItem]
  let start: Int
  let reset: Bool?
}

struct RemotePhoto: Codable, Hashable, Sendable {
  let name: String
  /// base64 of the file
  let data: String
}

/// What the phone may do to an exit (the Ship block's buttons).
enum ShipAction: Sendable {
  case start(exit: String)
  case edit(RemoteShip.Texts)
  case submit, retry, cancel, conflicts, switchPr

  var json: JSONValue {
    switch self {
    case .start(let exit): return .object(["do": .string("start"), "exit": .string(exit)])
    case .edit(let t):
      return .object(["do": .string("edit"), "texts": .object(["commit": .string(t.commit), "title": .string(t.title), "body": .string(t.body), "draft": .bool(t.draft)])])
    case .submit: return .object(["do": .string("submit")])
    case .retry: return .object(["do": .string("retry")])
    case .cancel: return .object(["do": .string("cancel")])
    case .conflicts: return .object(["do": .string("conflicts")])
    case .switchPr: return .object(["do": .string("switch-pr")])
    }
  }
}

/// Phone → Wavi (src/shared/remote.ts `PhoneCommand`); main validates every field again.
enum PhoneCommand: Sendable {
  case snapshot
  case watch(session: String?)
  case feed(session: String, before: Int)
  case send(session: String, text: String, photos: [RemotePhoto])
  case interrupt(session: String)
  case permission(prompt: String, decision: String)
  case answer(prompt: String, answers: [String: String])
  case newSessionInfo(project: String)
  case newSession(project: String, workdir: String, agent: String, base: String?, branch: String?, prompt: String?)
  case changes(session: String)
  case diff(session: String, path: String, scope: String, oldPath: String?, untracked: Bool)
  case exits(session: String)
  case ship(session: String, action: ShipAction)
  case archive(session: String)

  var fields: [String: JSONValue] {
    switch self {
    case .snapshot: return ["type": .string("snapshot")]
    case .watch(let s): return ["type": .string("watch"), "session": s.map { .string($0) } ?? .null]
    case .feed(let s, let before): return ["type": .string("feed"), "session": .string(s), "before": .number(Double(before))]
    case .send(let s, let text, let photos): return ["type": .string("send"), "session": .string(s), "text": .string(text), "photos": .from(photos)]
    case .interrupt(let s): return ["type": .string("interrupt"), "session": .string(s)]
    case .permission(let p, let d): return ["type": .string("permission"), "prompt": .string(p), "decision": .string(d)]
    case .answer(let p, let a): return ["type": .string("answer"), "prompt": .string(p), "answers": .object(a.mapValues { .string($0) })]
    case .newSessionInfo(let p): return ["type": .string("new-session-info"), "project": .string(p)]
    case .newSession(let project, let workdir, let agent, let base, let branch, let prompt):
      var f: [String: JSONValue] = ["type": .string("new-session"), "project": .string(project), "workdir": .string(workdir), "agent": .string(agent)]
      if let base { f["base"] = .string(base) }
      if let branch { f["branch"] = .string(branch) }
      if let prompt { f["prompt"] = .string(prompt) }
      return f
    case .changes(let s): return ["type": .string("changes"), "session": .string(s)]
    case .diff(let s, let path, let scope, let oldPath, let untracked):
      var f: [String: JSONValue] = ["type": .string("diff"), "session": .string(s), "path": .string(path), "scope": .string(scope)]
      if let oldPath { f["oldPath"] = .string(oldPath) }
      if untracked { f["untracked"] = .bool(true) }
      return f
    case .exits(let s): return ["type": .string("exits"), "session": .string(s)]
    case .ship(let s, let action): return ["type": .string("ship"), "session": .string(s), "action": action.json]
    case .archive(let s): return ["type": .string("archive"), "session": .string(s)]
    }
  }
}

/// A request's answer: `data` on success, the Mac's (Chinese) reason otherwise.
enum RemoteResult: Sendable {
  case ok(JSONValue?)
  case failed(String)

  var error: String? {
    if case .failed(let e) = self { return e }
    return nil
  }

  func decode<T: Decodable>(_ type: T.Type) -> T? {
    if case .ok(let data) = self { return data?.decode(T.self) }
    return nil
  }
}
