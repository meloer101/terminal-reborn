// Components.swift: Markdown tables (Figma 64A) next to the other blocks; MyAvatar.swift: the middle square.
import Foundation
import Testing
@testable import Wavi

@Suite struct MarkdownTests {
  @Test func aGitHubTableIsOneBlock() {
    let text = "三种方案：\n\n| 方案 | 续期时机 |\n|---|:---:|\n| 定时器 | 到期前 5 分钟 |\n| 401 拦截 |\n\n结论"
    #expect(markdownBlocks(text) == [
      .paragraph("三种方案："),
      .table(header: ["方案", "续期时机"], rows: [["定时器", "到期前 5 分钟"], ["401 拦截", ""]]),
      .paragraph("结论")
    ])
  }

  @Test func pipesWithoutADividerStayText() {
    #expect(markdownBlocks("a | b\nc | d") == [.paragraph("a | b\nc | d")])
  }

  @Test func anEscapedPipeStaysInItsCell() {
    #expect(tableCells("| a \\| b | c |") == ["a | b", "c"])
  }

  @Test func theAvatarIsTheMiddleSquare() {
    #expect(squareCrop(CGSize(width: 400, height: 300)) == CGRect(x: 50, y: 0, width: 300, height: 300))
    #expect(squareCrop(CGSize(width: 300, height: 500)) == CGRect(x: 0, y: 100, width: 300, height: 300))
  }
}
