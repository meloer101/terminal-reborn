// Small marks used everywhere: the status glyph (the desktop's StatusGlyph v3, Figma 627:27332 — each state its own
// shape, never colour alone), the agent's mark (Figma 34K) and +/− counts.
import SwiftUI

/// 14×14: a turning arc (running), the halo dot (needs you), a check, a warning triangle, a ring, a dash.
struct StatusGlyph: View {
  let status: SessionStatus

  var body: some View {
    Group {
      switch status {
      case .running: Spinner()
      case .needsYou:
        ZStack {
          Circle().fill(Color.statusAttentionBg)
          Circle().fill(Color.statusAttention).frame(width: 8, height: 8)
        }
      case .doneUnread:
        Path { p in
          p.move(to: CGPoint(x: 3.2, y: 7.3))
          p.addLine(to: CGPoint(x: 5.9, y: 10))
          p.addLine(to: CGPoint(x: 10.8, y: 4.4))
        }
        .stroke(Color.statusDone, style: StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
      case .error:
        ZStack {
          Path { p in
            p.move(to: CGPoint(x: 7, y: 2.1))
            p.addLine(to: CGPoint(x: 12.3, y: 11.4))
            p.addLine(to: CGPoint(x: 1.7, y: 11.4))
            p.closeSubpath()
            p.move(to: CGPoint(x: 7, y: 5.6))
            p.addLine(to: CGPoint(x: 7, y: 8))
          }
          .stroke(Color.statusError, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
          Circle().fill(Color.statusError).frame(width: 1.4, height: 1.4).position(x: 7, y: 9.75)
        }
      case .idle: Circle().stroke(Color.statusIdle, lineWidth: 1.5).frame(width: 6.5, height: 6.5)
      case .exited:
        Path { p in
          p.move(to: CGPoint(x: 4.25, y: 7))
          p.addLine(to: CGPoint(x: 9.75, y: 7))
        }
        .stroke(Color.textHint, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
      }
    }
    .frame(width: 14, height: 14)
    .accessibilityLabel(status.label)
  }
}

/// A 14×14 turning arc: the running status in the status colour, or a loading mark in a text colour. Still under Reduce
/// Motion (the arc alone still says "in progress").
struct Spinner: View {
  var color: Color = .statusWorking
  @State private var turning = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Path { p in p.addArc(center: CGPoint(x: 7, y: 7), radius: 4.5, startAngle: .degrees(-90), endAngle: .degrees(180), clockwise: false) }
      .stroke(color, style: StrokeStyle(lineWidth: 1.75, lineCap: .round))
      .frame(width: 14, height: 14)
      .rotationEffect(.degrees(turning ? 360 : 0))
      .animation(reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false), value: turning)
      .onAppear { if !reduceMotion { turning = true } }
  }
}

/// The CLI's own one-colour logo in the text colour, the terminal glyph for a shell, the first letter for the few
/// CLIs without a logo (as the desktop's AgentIcon).
struct AgentMark: View {
  let agent: String
  var size: CGFloat = 12

  var body: some View {
    let info = Shared.agent(agent)
    Group {
      if agent == "shell" {
        Icon("square-terminal", size: size)
      } else if info.mark {
        Image("Agents/\(agent)").resizable().renderingMode(.template).scaledToFit().frame(width: size, height: size)
      } else {
        Text(String(info.name.prefix(1))).font(.fixed(size * 0.68, medium: true))
          .frame(width: size, height: size)
          .background(Color.fillSubtle, in: RoundedRectangle(cornerRadius: 3))
      }
    }
    .foregroundStyle(Color.textPrimary)
    .accessibilityLabel(info.name)
  }
}

/// +12 −3 in the diff colours; a zero side is left out.
struct Counts: View {
  let added: Int?
  let removed: Int?
  var style: TypeStyle = .caption

  var body: some View {
    HStack(spacing: 4) {
      if let added, added > 0 { Text("+\(added)").foregroundStyle(Color.diffAddFg) }
      if let removed, removed > 0 { Text("−\(removed)").foregroundStyle(Color.diffDelFg) }
    }
    .font(.mono(style, medium: true))
  }
}
