// 首次打开 · 扫码配对 (Figma 63A1–63A6): scan the QR code 设置 · 手机 shows on the Mac, or type its address and pairing
// code (the PAKE in Net/Crypto.swift brings the Mac's key then). Pairing and failures show as a notice under the
// viewfinder; without the camera, 打开设置 comes first. Opened with an offer (a `wavi://pair` link from elsewhere), it asks
// which Mac first and says when that replaces the current pairing.
import AVFoundation
import SwiftUI

struct PairView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Binding var offer: PairingOffer?
  /// The Mac paired now, which a confirmed offer replaces.
  var replacing: String?
  @State private var busy = false
  @State private var error: String?
  @State private var typing = false
  @State private var address = ""
  @State private var code = ""
  @State private var handled: String?
  /// The linked offer was answered (the alert does not come back while its attempt runs or after it failed).
  @State private var asked = false
  /// The Mac being paired with (from the scanned code), for 正在和「…」配对.
  @State private var pairingWith: String?
  /// No camera picture: `denied` when access was refused (打开设置 helps), otherwise there is no camera.
  @State private var cameraBlocked = false
  @State private var cameraDenied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("扫描 Mac 上的二维码").font(.ui(.title2)).foregroundStyle(Color.textPrimary)
      Spacer(minLength: 24)
      ZStack {
        Color.bgGrouped
        QRScanner(onCode: { scanned($0) }, onBlocked: { denied in cameraBlocked = true; cameraDenied = denied })
        Viewfinder().stroke(Color.textPrimary, style: StrokeStyle(lineWidth: 3, lineCap: .round)).padding(12).opacity(cameraBlocked ? 0.3 : 1)
      }
      .aspectRatio(1, contentMode: .fit)
      .frame(maxWidth: 280)
      .clipShape(RoundedRectangle(cornerRadius: Metric.radiusGroup))
      .frame(maxWidth: .infinity)
      Group {
        if busy && !typing {
          Notice(tone: .info, message: pairingWith.map { "正在和 \($0) 配对" } ?? "正在配对")
        } else if let error, !typing {
          Notice(tone: .danger, message: error)
        } else {
          Color.clear.frame(height: 44)
        }
      }
      .padding(.top, 24)
      Spacer(minLength: 24)
      VStack(spacing: 8) {
        if cameraDenied {
          Button("打开设置") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }.buttonStyle(.wavi(primary: true))
        }
        Button("输入配对码") { error = nil; typing = true }.buttonStyle(.wavi).disabled(busy)
      }
    }
    .padding(.horizontal, 24)
    .padding(.top, 40)
    .padding(.bottom, 16)
    .background(Color.bgApp)
    .sheet(isPresented: $typing) { typed }
    // Another link opened: ask about that one.
    .onChange(of: offer?.code) { asked = false }
    .alert(offer.map { "和「\($0.name)」配对？" } ?? "", isPresented: Binding(get: { offer != nil && !asked }, set: { if !$0 && !asked { offer = nil } }), presenting: offer) { offer in
      Button("取消", role: .cancel) { self.offer = nil; if replacing != nil { dismiss() } }
      Button("配对") {
        asked = true
        run { try await Link.pair(offer: offer, phoneName: AppModel.phoneName) }
      }
    } message: { offer in
      let hosts = offer.urls.map { $0.replacing(/^wss?:\/\//, with: "") }.joined(separator: "、")
      Text(replacing.map { "\(hosts)\n会替换现在配对的「\($0)」" } ?? hosts)
    }
  }

  private var typed: some View {
    let url = Link.addressURL(address, defaultPort: Shared.data.pairing.defaultPort)
    let bare = code.uppercased().filter { $0.isLetter || $0.isNumber }
    return VStack(alignment: .leading, spacing: 16) {
      Text("输入配对码").font(.ui(.title2)).foregroundStyle(Color.textPrimary)
      field("Mac 的地址") {
        TextField("100.101.1.2", text: $address).font(.mono()).keyboardType(.URL)
      }
      field("配对码") {
        TextField("4KX-92Q", text: $code).font(.mono(.title2)).textInputAutocapitalization(.characters)
          .onChange(of: code) { _, now in
            let letters = now.uppercased().filter { $0.isLetter || $0.isNumber }
            if letters.count == 6, now != "\(letters.prefix(3))-\(letters.suffix(3))" { code = "\(letters.prefix(3))-\(letters.suffix(3))" }
          }
      }
      if let error { Notice(tone: .danger, message: error) }
      Button {
        guard let url else { return }
        run { try await Link.pair(url: url, rawCode: bare, phoneName: AppModel.phoneName) }
      } label: {
        if busy { Spinner(color: .solidOn) } else { Text("配对") }
      }
      .buttonStyle(.wavi(primary: true))
      .disabled(url == nil || bare.count != 6 || busy)
    }
    .padding(.horizontal, 20)
    .padding(.top, 24)
    .padding(.bottom, 20)
    .presentationDetents([.medium])
    .interactiveDismissDisabled(busy)
  }

  private func field(_ label: String, @ViewBuilder input: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label).font(.ui(.footnote, medium: true)).foregroundStyle(Color.textSecondary)
      input().foregroundStyle(Color.textPrimary).autocorrectionDisabled().textInputAutocapitalization(.never)
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
    }
  }

  private func scanned(_ text: String) {
    guard !busy, handled != text else { return }
    handled = text
    guard let offer = Link.parseOffer(text) else {
      error = "这不是 Wavi 的配对二维码"
      return
    }
    pairingWith = offer.name
    run { try await Link.pair(offer: offer, phoneName: AppModel.phoneName) }
  }

  private func run(_ attempt: @escaping () async throws -> Pairing) {
    busy = true
    error = nil
    Task {
      do {
        let pairing = try await attempt()
        model.adopt(pairing)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        typing = false
        offer = nil
        if replacing != nil { dismiss() }
      } catch {
        self.error = (error as? PairError)?.message ?? "配对没有成功"
        handled = nil
        pairingWith = nil
      }
      busy = false
    }
  }
}

/// The four rounded corners of the viewfinder.
private struct Viewfinder: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    let arm: CGFloat = 38
    let r: CGFloat = 16
    for (corner, dx, dy) in [(CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0), (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0), (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0), (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0)] {
      p.move(to: CGPoint(x: corner.x, y: corner.y + dy * arm))
      p.addLine(to: CGPoint(x: corner.x, y: corner.y + dy * r))
      p.addQuadCurve(to: CGPoint(x: corner.x + dx * r, y: corner.y), control: corner)
      p.addLine(to: CGPoint(x: corner.x + dx * arm, y: corner.y))
    }
    return p
  }
}

/// The back camera reading QR codes; a line of text where the picture would be when there is no camera or no access.
struct QRScanner: UIViewControllerRepresentable {
  let onCode: (String) -> Void
  /// No camera access (or no camera): the screen offers 打开设置.
  var onBlocked: (_ denied: Bool) -> Void = { _ in }

  func makeUIViewController(context: Context) -> ScannerController {
    let controller = ScannerController()
    controller.onCode = onCode
    controller.onBlocked = onBlocked
    return controller
  }

  func updateUIViewController(_ controller: ScannerController, context: Context) {
    controller.onCode = onCode
    controller.onBlocked = onBlocked
  }

  final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    var onBlocked: ((_ denied: Bool) -> Void)?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?

    override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .clear
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          if granted { self.setUp() } else {
            self.say("在设置里允许 Wavi 使用相机，或者输入配对码")
            self.onBlocked?(true)
          }
        }
      }
    }

    override func viewDidLayoutSubviews() {
      super.viewDidLayoutSubviews()
      preview?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
      super.viewWillDisappear(animated)
      let session = self.session
      DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
    }

    private func setUp() {
      guard let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
        say("这台设备没有相机，输入配对码")
        onBlocked?(false)
        return
      }
      session.addInput(input)
      let output = AVCaptureMetadataOutput()
      guard session.canAddOutput(output) else { return }
      session.addOutput(output)
      output.setMetadataObjectsDelegate(self, queue: .main)
      output.metadataObjectTypes = [.qr]
      let preview = AVCaptureVideoPreviewLayer(session: session)
      preview.videoGravity = .resizeAspectFill
      preview.frame = view.bounds
      view.layer.insertSublayer(preview, at: 0)
      self.preview = preview
      let session = self.session
      DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    private func say(_ text: String) {
      let label = UILabel()
      label.text = text
      label.numberOfLines = 0
      label.textAlignment = .center
      label.font = .preferredFont(forTextStyle: .subheadline)
      label.adjustsFontForContentSizeCategory = true
      label.textColor = .label
      label.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(label)
      NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: view.centerXAnchor), label.centerYAnchor.constraint(equalTo: view.centerYAnchor), label.widthAnchor.constraint(equalToConstant: 220)])
    }

    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
      let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue
      MainActor.assumeIsolated { if let code { onCode?(code) } }
    }
  }
}
