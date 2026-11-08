// TranscriptGroups.swift: consecutive tool calls fold into one line, a finished turn that changed files ends with its
// totals, answers are left where they happened (Figma 62E).
import Foundation
import Testing
@testable import Wavi

private func user(_ id: String, at: Double) -> ChatItem { ChatItem(kind: "user", id: id, at: at, text: "go") }
private func text(_ id: String, at: Double) -> ChatItem { ChatItem(kind: "text", id: id, at: at, text: "done") }
private func tool(_ id: String, _ name: String, _ arg: String, at: Double, state: String = "ok", added: Int = 0, removed: Int = 0) -> ChatItem {
  let diff = added + removed > 0 ? ToolDiff(path: arg, hunks: [], added: added, removed: removed, truncated: false) : nil
  return ChatItem(kind: "tool", id: id, at: at, name: name, arg: arg, state: state, diff: diff)
}

@Suite struct TranscriptGroupsTests {
  @Test func consecutiveToolCallsFoldIntoOneLine() {
    let items = [user("u", at: 1), tool("a", "Read", "a.ts", at: 2), tool("b", "Read", "b.ts", at: 3), tool("c", "Grep", "x", at: 4), tool("d", "Bash", "pnpm test", at: 5), text("t", at: 6), tool("e", "Read", "c.ts", at: 7)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: true)
    #expect(blocks.map(\.id) == ["u", "run-a", "t", "e"])
    guard case .tools(let run) = blocks[1] else { Issue.record("no run"); return }
    #expect(run.summary == "读了 2 个文件，搜索了 1 次，跑了 1 条命令")
    #expect(run.items.map(\.id) == ["a", "b", "c", "d"])
    #expect(!run.running)
  }

  @Test func aFinishedTurnThatChangedFilesEndsWithItsTotals() {
    let items = [user("u1", at: 1), tool("a", "Edit", "a.ts", at: 2, added: 10, removed: 2), tool("b", "Edit", "a.ts", at: 3, added: 4), tool("c", "Write", "b.ts", at: 4, added: 20),
      text("t", at: 5), user("u2", at: 6), tool("d", "Edit", "c.ts", at: 7, state: "running", added: 1)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: true)
    #expect(blocks.map(\.id) == ["u1", "run-a", "t", "turn-u1", "u2", "d"])
    guard case .turn(let turn) = blocks[3], case .tools(let run) = blocks[1] else { Issue.record("no turn"); return }
    #expect(turn == TurnChange(id: "turn-u1", files: 2, added: 34, removed: 2, tools: ["a", "b", "c"]))
    #expect(run.summary == "改了 2 个文件")
    // The totals are said once, at the end of the turn.
    #expect(!run.showCounts)
    // The open turn (the agent is still at it) has none yet.
    #expect(!blocks.contains { $0.id == "turn-u2" })
  }

  @Test func theLastTurnGetsItsTotalsOnceTheAgentStops() {
    let items = [user("u1", at: 1), tool("a", "Edit", "a.ts", at: 2, added: 3, removed: 1), text("t", at: 3)]
    #expect(transcriptBlocks(items, receipts: [], turnOpen: false).map(\.id) == ["u1", "a", "t", "turn-u1"])
    #expect(transcriptBlocks(items, receipts: [], turnOpen: true).map(\.id) == ["u1", "a", "t"])
  }

  @Test func answersSitWhereTheyHappened() {
    let items = [user("u", at: 1), tool("a", "Bash", "pnpm add -D msw", at: 2), tool("b", "Bash", "pnpm test", at: 10)]
    let receipt = Receipt(id: "r1", at: 5, onPhone: true, text: "在这台手机上允许 · pnpm add -D msw")
    let blocks = transcriptBlocks(items, receipts: [receipt], turnOpen: true)
    // The answer splits the run: the call before it and the one after stay single rows.
    #expect(blocks.map(\.id) == ["u", "a", "r1", "b"])
  }

  @Test func answersAfterTheLastItemKeepTheirOrder() {
    let items = [user("u", at: 1), text("t", at: 2)]
    let first = Receipt(id: "r1", at: 5, onPhone: true, text: "a")
    let second = Receipt(id: "r2", at: 9, onPhone: false, text: "b")
    #expect(transcriptBlocks(items, receipts: [second, first], turnOpen: true).map(\.id) == ["u", "t", "r1", "r2"])
  }

  @Test func receiptWordsSayWhereAndWhat() {
    let permission = RemotePrompt(kind: "permission", id: "p", sessionId: "s", createdAt: 0, answerable: true, tool: "Bash", summary: "pnpm add -D msw")
    #expect(receiptText(permission, decision: "allow-once", onPhone: true) == "在这台手机上允许 · pnpm add -D msw")
    #expect(receiptText(permission, decision: "deny", onPhone: true) == "在这台手机上拒绝 · pnpm add -D msw")
    #expect(receiptText(permission, decision: nil, onPhone: false) == "在 Mac 上处理 · pnpm add -D msw")
    let q = AgentQuestion(header: nil, question: "用哪种存储？", multiSelect: false, options: [])
    let question = RemotePrompt(kind: "question", id: "q", sessionId: "s", createdAt: 0, answerable: true, questions: [q])
    #expect(receiptText(question, decision: nil, onPhone: false) == "在 Mac 上回答 · 用哪种存储？")
  }
}
