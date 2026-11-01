// The Live Activity's data (PRD F22 S2, Figma 47), in both the app and the WaviActivity extension: one activity per
// paired Mac, showing the oldest prompt waiting on the phone, else the running sessions, else a session that just
// finished or failed. The app builds the state (Model/ActivityState.swift); the extension only draws it.
import ActivityKit
import Foundation

struct WaviActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable { case permission, question, running, done, error }

    struct Running: Codable, Hashable, Sendable {
      var id: String
      var title: String
      var agent: String
      var action: String
      /// Its last activity.
      var since: Date
    }

    var kind: Kind
    /// The session a tap opens; nil for `running` (the session list).
    var session: String?
    var prompt: String?
    var title: String = ""
    var agent: String = ""
    /// The question, the session's last action, or what went wrong.
    var detail: String = ""
    /// A permission's command, file or address (drawn in mono after `detail`).
    var subject: String?
    /// Since when it has waited, or when it finished.
    var since: Date
    /// A question's options with a button of their own; `more` when it has others (the last button opens the app).
    var options: [String] = []
    var more = false
    /// An answer from the phone reaches the agent (the Mac's hook still holds the prompt).
    var answerable = false
    var running: [Running] = []
    var runningCount = 0
    /// The last answer from the Lock Screen or the island did not reach the Mac.
    var failure: String?
  }

  /// The Mac's name (设置 · 手机).
  var mac: String
}

/// Where a tap on the activity goes: `wavi://session?id=…`, or the list.
enum ActivityLink {
  static func url(session: String?) -> URL {
    guard let session, var parts = URLComponents(string: "wavi://session") else { return URL(string: "wavi://sessions")! }
    parts.queryItems = [URLQueryItem(name: "id", value: session)]
    return parts.url ?? URL(string: "wavi://sessions")!
  }

  /// The session a link opens; `.some(nil)` for the list; nil when it is not an activity link.
  static func session(in url: URL) -> String?? {
    guard url.scheme == "wavi" else { return nil }
    switch url.host {
    case "sessions": return .some(nil)
    case "session": return .some(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value)
    default: return nil
    }
  }
}
