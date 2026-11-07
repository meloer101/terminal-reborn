// ActivityState.swift: what the Live Activity shows for the sessions and prompts Wavi sent.
import Foundation
import Testing
@testable import Wavi

private func session(_ id: String, status: SessionStatus, since: Double? = nil, activity: Double = 0, action: String? = nil) -> RemoteSession {
  RemoteSession(id: id, projectId: "p", title: "t-\(id)", agent: "claude", status: status, action: action, since: since, activity: activity, branch: nil,
    model: nil, reply: nil, ship: nil, shipNotice: nil)
}

private func question(_ id: String, at: Double, options: [String], multi: Bool = false, count: Int = 1, answerable: Bool = true) -> RemotePrompt {
  let q = AgentQuestion(header: nil, question: "按什么排序？", multiSelect: multi, options: options.map { QuestionOption(label: $0, description: nil) })
  return RemotePrompt(kind: "question", id: id, sessionId: "s1", createdAt: at, answerable: answerable, questions: Array(repeating: q, count: count))
}

@Suite struct ActivityStateTests {
  @Test func oldestPromptWinsOverRunning() {
    let sessions = [session("s1", status: .needsYou), session("s2", status: .running)]
    let permission = RemotePrompt(kind: "permission", id: "p1", sessionId: "s1", createdAt: 2000, answerable: true, tool: "Bash",
      input: ["command": .string("pnpm lint")], summary: "pnpm lint")
    let state = activityState(sessions: sessions, prompts: [question("p2", at: 5000, options: ["a"]), permission], now: 9000)
    #expect(state?.kind == .permission)
    #expect(state?.prompt == "p1")
    #expect(state?.title == "t-s1")
    #expect(state?.detail == "运行命令")
    #expect(state?.subject == "pnpm lint")
    #expect(state?.answerable == true)
    #expect(state?.since == Date(timeIntervalSince1970: 2))
  }

  @Test func questionOptionsGetButtonsUpToThree() {
    let three = activityState(sessions: [], prompts: [question("q", at: 0, options: ["a", "b", "c"])], now: 0)
    #expect(three?.options == ["a", "b", "c"])
    #expect(three?.more == false)
    let five = activityState(sessions: [], prompts: [question("q", at: 0, options: ["a", "b", "c", "d", "e"])], now: 0)
    #expect(five?.options == ["a", "b"])
    #expect(five?.more == true)
    #expect(five?.detail == "按什么排序？")
  }

  @Test func questionsTheIslandCannotAnswerHaveNoButtons() {
    for prompt in [question("q", at: 0, options: ["a"], multi: true), question("q", at: 0, options: ["a"], count: 2),
      question("q", at: 0, options: ["a"], answerable: false), question("q", at: 0, options: []),
      question("q", at: 0, options: [String(repeating: "长", count: 200)])] {
      let state = activityState(sessions: [], prompts: [prompt], now: 0)
      #expect(state?.kind == .question)
      #expect(state?.answerable == false)
      #expect(state?.options == [])
    }
  }

  @Test func runningShowsTheTwoNewest() {
    let sessions = [session("a", status: .running, activity: 1, action: "编辑 a.ts"), session("b", status: .running, activity: 3),
      session("c", status: .running, activity: 2), session("d", status: .idle, activity: 9)]
    let state = activityState(sessions: sessions, prompts: [], now: 10)
    #expect(state?.kind == .running)
    #expect(state?.runningCount == 3)
    #expect(state?.running.map(\.id) == ["b", "c"])
    #expect(state?.session == nil)
  }

  @Test func recentlyFinishedOrFailedThenNothing() {
    let now = 20.0 * 60 * 1000
    let sessions = [session("old", status: .doneUnread, since: 0), session("err", status: .error, since: now - 60_000, action: "pnpm test 退出码 1"),
      session("done", status: .doneUnread, since: now - 120_000)]
    let state = activityState(sessions: sessions, prompts: [], now: now)
    #expect(state?.kind == .error)
    #expect(state?.session == "err")
    #expect(state?.detail == "pnpm test 退出码 1")
    #expect(activityState(sessions: [session("old", status: .doneUnread, since: 0)], prompts: [], now: now)?.kind == .idle)
  }

  @Test func quietForHalfAnHourThenNothing() {
    let min = 60_000.0
    let sessions = [session("a", status: .idle, activity: 5 * min), session("b", status: .doneUnread, since: 12 * min, activity: 11 * min),
      session("c", status: .exited, activity: 2 * min)]
    let state = activityState(sessions: sessions, prompts: [], now: 25 * min, mac: "MacBook Pro")
    #expect(state?.kind == .idle)
    #expect(state?.title == "MacBook Pro")
    #expect(state?.detail == "3 个会话")
    #expect(state?.since == Date(timeIntervalSince1970: 12 * 60))
    #expect(state?.session == nil)
    #expect(activityState(sessions: sessions, prompts: [], now: 42 * min)?.kind == .idle)
    #expect(activityState(sessions: sessions, prompts: [], now: 42.01 * min) == nil)
    #expect(activityState(sessions: [], prompts: [], now: 0) == nil)
  }

  @Test func longTextIsCutButALongQuestionIsLeftToTheApp() {
    var long = question("q", at: 0, options: ["a"])
    long.questions = [AgentQuestion(header: nil, question: String(repeating: "长", count: 400), multiSelect: false, options: [QuestionOption(label: "a", description: nil)])]
    let state = activityState(sessions: [], prompts: [long], now: 0)
    #expect(state?.detail.count == ActivityLimits.question)
    #expect(state?.answerable == false)
  }

  @Test func linksRoundTrip() {
    #expect(ActivityLink.session(in: ActivityLink.url(session: "abc 1")) == .some("abc 1"))
    #expect(ActivityLink.session(in: ActivityLink.url(session: nil)) == .some(nil))
    #expect(ActivityLink.session(in: URL(string: "wavi://pair?d=x")!) == nil)
  }

  @Test func aWaitingCardSaysWhatElseIsGoingOn() {
    let sessions = [session("s1", status: .needsYou), session("s2", status: .needsYou), session("s3", status: .running), session("s4", status: .running)]
    let prompts = [question("p1", at: 1000, options: ["a"]), question("p2", at: 2000, options: ["b"])]
    #expect(activityState(sessions: sessions, prompts: prompts, now: 9000)?.others == "另有 1 个等你处理 · 2 个运行中")
    #expect(activityState(sessions: [session("s1", status: .needsYou)], prompts: [question("p1", at: 1000, options: ["a"])], now: 9000)?.others == nil)
    #expect(activityState(sessions: [session("s1", status: .needsYou), session("s3", status: .running)], prompts: [question("p1", at: 1000, options: ["a"])], now: 9000)?.others == "另有 1 个运行中")
  }
}

