// What the Live Activity shows (PRD F22 S2, Figma 47), from what Wavi last sent: the oldest prompt the phone can see,
// else the running sessions, else a session that finished or failed in the last few minutes; nil ends the activity.
// Pure; WaviTests/ActivityStateTests.swift.
import Foundation

typealias ActivityState = WaviActivityAttributes.ContentState

enum ActivityLimits {
  /// A finished or failed session stays this long when nothing else is going on.
  static let recentMs = 10.0 * 60 * 1000
  /// Option buttons on the island and the Lock Screen; a question with more gets a 更多 button in the last place.
  static let options = 3
  /// The whole state must stay under ActivityKit's 4 KB: longer text is cut (a question that long is answered in the app,
  /// since its answer is keyed by the exact question).
  static let text = 160
  static let question = 300
}

private func cut(_ text: String, _ limit: Int = ActivityLimits.text) -> String {
  text.count > limit ? String(text.prefix(limit - 1)) + "…" : text
}

private func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

func activityState(sessions: [RemoteSession], prompts: [RemotePrompt], now: Double) -> ActivityState? {
  let byId = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
  if let prompt = prompts.min(by: { $0.createdAt < $1.createdAt }) {
    let session = byId[prompt.sessionId]
    var state = ActivityState(kind: prompt.kind == "permission" ? .permission : .question, session: prompt.sessionId, prompt: prompt.id,
      title: cut(session?.title ?? ""), agent: session?.agent ?? "", since: date(prompt.createdAt))
    if prompt.kind == "permission" {
      state.detail = permissionTitle(prompt.tool ?? "")
      state.subject = cut(permissionSubject(prompt.input ?? [:], summary: prompt.summary ?? ""))
      state.answerable = prompt.answerable
    } else {
      let questions = prompt.questions ?? []
      let first = questions.first
      state.detail = cut(first?.question ?? "", ActivityLimits.question)
      // One question with one choice is answered with a tap; anything else needs the sheet in the app.
      let tappable = questions.count == 1 && first?.multiSelect == false && (first?.question.count ?? 0) <= ActivityLimits.question
      let labels = first?.options.map(\.label) ?? []
      // Labels are sent back as they are (the answer is keyed by them), so long ones are left to the app.
      if tappable && prompt.answerable && !labels.isEmpty && labels.prefix(ActivityLimits.options).allSatisfy({ $0.count <= ActivityLimits.text }) {
        state.answerable = true
        state.more = labels.count > ActivityLimits.options
        state.options = Array(labels.prefix(state.more ? ActivityLimits.options - 1 : ActivityLimits.options))
      }
    }
    return state
  }
  let running = sessions.filter { $0.status == .running }.sorted { $0.activity > $1.activity }
  if let newest = running.first {
    return ActivityState(kind: .running, session: nil, prompt: nil, since: date(newest.since ?? newest.activity),
      running: running.prefix(2).map { .init(id: $0.id, title: cut($0.title), agent: $0.agent, action: cut($0.action ?? $0.status.label), since: date($0.activity)) },
      runningCount: running.count)
  }
  let finished = sessions.filter { ($0.status == .doneUnread || $0.status == .error) && now - ($0.since ?? $0.activity) <= ActivityLimits.recentMs }
    .max { ($0.since ?? $0.activity) < ($1.since ?? $1.activity) }
  if let finished {
    return ActivityState(kind: finished.status == .error ? .error : .done, session: finished.id, prompt: nil, title: cut(finished.title),
      agent: finished.agent, detail: cut(finished.action ?? finished.status.label), since: date(finished.since ?? finished.activity))
  }
  return nil
}
