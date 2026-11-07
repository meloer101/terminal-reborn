// Format.swift, with the cases of the Expo app's model.test.ts.
import Foundation
import Testing
@testable import Wavi

private func text(_ n: Int, _ t: String? = nil) -> ChatItem { ChatItem(kind: "text", id: "i\(n)", at: 0, text: t ?? "t\(n)") }

private func session(_ id: String = "s", project: String = "p1", status: SessionStatus = .idle, since: Double? = nil, activity: Double = 0) -> RemoteSession {
  RemoteSession(id: id, projectId: project, title: "x", agent: "claude", status: status, action: nil, since: since, activity: activity, branch: nil, model: nil, reply: nil, ship: nil, shipNotice: nil)
}

@Suite struct FormatTests {
  @Test func feedStartsExtendsAndRewritesItsEnd() {
    var feed = applyFeed(nil, start: 50, items: [text(50), text(51)])
    feed = applyFeed(feed, start: 52, items: [text(52)])
    #expect(feed.items.map(\.id) == ["i50", "i51", "i52"])
    feed = applyFeed(feed, start: 52, items: [text(52, "changed"), text(53)])
    #expect(feed == Feed(start: 50, items: [text(50), text(51), text(52, "changed"), text(53)]))
  }

  @Test func staleNoticeSaysHowOldTheListIs() {
    let now = 10_000_000.0
    #expect(staleNotice(heardAt: now - 20_000, now: now) == "显示的是 1 分钟内的状态")
    #expect(staleNotice(heardAt: now - 12 * 60_000, now: now) == "显示的是 12 分钟前的状态")
    #expect(staleNotice(heardAt: now - 125 * 60_000, now: now) == "显示的是 2 小时前的状态")
    #expect(staleNotice(heardAt: nil, now: now) == "显示的不是最新的状态")
  }

  @Test func feedResetsOnResetOrGap() {
    let feed = Feed(start: 0, items: [text(0)])
    #expect(applyFeed(feed, start: 0, items: [], reset: true) == Feed(start: 0, items: []))
    #expect(applyFeed(feed, start: 5, items: [text(5)]) == Feed(start: 5, items: [text(5)]))
  }

  @Test func olderPageGoesInFrontOnlyWhenItEndsAtTheStart() {
    let feed = Feed(start: 2, items: [text(2)])
    #expect(prependFeed(feed, start: 0, items: [text(0), text(1)]).items.count == 3)
    #expect(prependFeed(feed, start: 0, items: [text(0)]) == feed)
  }

  @Test func groupsWaitingFirstThenProjectsNewestFirst() {
    let groups = groupSessions(RemoteSessionList(
      projects: [.init(id: "p1", name: "acme-web"), .init(id: "p2", name: "terminal-reborn"), .init(id: "p3", name: "empty")],
      sessions: [
        session("a", activity: 1), session("b", activity: 5),
        session("w1", project: "p2", status: .needsYou, since: 300), session("w2", status: .needsYou, since: 100),
        session("c", project: "p2", activity: 2)
      ]))
    #expect(groups.map(\.title) == ["等你处理", "acme-web", "terminal-reborn"])
    #expect(groups.map { $0.rows.map(\.session.id) } == [["w1", "w2"], ["b", "a"], ["c"]])
    #expect(groups[0].rows[1].projectName == "acme-web")
    #expect(groups[1].rows[0].projectName == nil)
  }

  @Test func shortAgesAndRowTime() {
    #expect([shortAge(40_000), shortAge(180_000), shortAge(7_200_000), shortAge(200_000_000)] == ["40s", "3m", "2h", "2d"])
    #expect(rowTime(session(status: .needsYou, since: 0), now: 120_000) == "已等 2m")
    #expect(rowTime(session(activity: 0), now: 60_000) == "1m")
  }

  @Test func connectionPathsAndLastLine() {
    #expect(viaOf("ws://100.101.2.3:7429") == "Tailscale")
    #expect(viaOf("ws://100.20.2.3:7429") == "局域网")
    #expect(viaOf("ws://192.168.1.5:7429") == "局域网")
    #expect(splitPath("src/auth/session.ts") == ("session.ts", "src/auth/"))
    #expect(lastLine("a\n✓ 12 passed (1.4s)\n\n") == "✓ 12 passed (1.4s)")
    #expect(lastLine(nil) == nil)
  }

  @Test func numbersStructuredPatchHunks() {
    let rows = hunkRows([DiffHunk(oldStart: 12, newStart: 12, lines: [" a", "-b", "+c", "+d", " e"])])
    #expect(rows[0] == .hunk("@@ -12,3 +12,4 @@"))
    #expect(Array(rows.dropFirst()) == [
      .line(sign: " ", old: 12, new: 12, code: "a"), .line(sign: "-", old: 13, new: nil, code: "b"),
      .line(sign: "+", old: nil, new: 13, code: "c"), .line(sign: "+", old: nil, new: 14, code: "d"),
      .line(sign: " ", old: 14, new: 15, code: "e")
    ])
  }

  @Test func readsGitDiffText() {
    let rows = unifiedRows("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+c\n\\ No newline at end of file\n")
    #expect(rows == [.hunk("@@ -1,2 +1,2 @@ fn"), .line(sign: " ", old: 1, new: 1, code: "a"), .line(sign: "-", old: 2, new: nil, code: "b"), .line(sign: "+", old: nil, new: 2, code: "c")])
  }

  @Test func permissionSheetText() {
    #expect(permissionTitle("Bash") == "运行命令")
    #expect(permissionTitle("mcp__x") == "使用 mcp__x")
    #expect(permissionSubject(["command": .string("pnpm add -D msw"), "description": .string("x")], summary: "s") == "pnpm add -D msw")
    #expect(permissionSubject([:], summary: "运行 x") == "运行 x")
    #expect(allowAlwaysLabel([PermissionRule(tool: "Bash", content: "pnpm add:*")]) == "总是允许 pnpm add")
    #expect(allowAlwaysLabel([PermissionRule(tool: "WebFetch", content: "domain:example.com"), PermissionRule(tool: "Bash", content: nil)]) == "总是允许 example.com 等 2 项")
    #expect(allowAlwaysLabel(nil) == "总是允许")
  }

  @Test func branchNamesAvoidTakenOnes() {
    let name = generateBranchName(prefix: "jacob", taken: [])
    #expect(name.hasPrefix("jacob/"))
    #expect(name.split(separator: "/")[1].split(separator: "-").count >= 2)
  }

  @Test func decodesWhatTheMacSends() throws {
    let json = #"{"id":"s1","projectId":"p1","title":"导航","agent":"claude","status":"weird","activity":1,"extra":true}"#
    let s = try JSONDecoder().decode(RemoteSession.self, from: Data(json.utf8))
    #expect(s.status == .idle)
    #expect(SessionStatus.needsYou.label == "等你处理")
    let item = try JSONDecoder().decode(ChatItem.self, from: Data(#"{"kind":"tool","id":"t","at":2,"name":"Edit","arg":"a.ts","state":"ok","diff":{"path":"a.ts","hunks":[],"added":1,"removed":0,"truncated":false}}"#.utf8))
    #expect(item.diff?.added == 1)
    let fields = PhoneCommand.diff(session: "s", path: "a", scope: "committed", oldPath: nil, untracked: true).fields
    #expect(fields["untracked"] == .bool(true))
    #expect(fields["oldPath"] == nil)
  }
}
