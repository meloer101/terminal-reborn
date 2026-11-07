// The input under a conversation (Figma 59 Mobile/Composer, 63C3 / 63C5 / 63C6): one glass field — + for photos from the
// camera or the library (up to six), the text, and one round button: send when there is something to send, stop (Esc)
// while the agent runs; without a link it is off and says why. A failed send comes back into the field under a notice.
// Photos are drawn again as JPEG on the phone before they go: that drops their EXIF, location included.
import PhotosUI
import SwiftUI

struct Composer: View {
  let session: String
  let running: Bool
  @Environment(AppModel.self) private var model
  @State private var text = ""
  @State private var photos: [Picked] = []
  @State private var picking = false
  @State private var picked: [PhotosPickerItem] = []
  @State private var shooting = false
  @State private var sending = false
  @State private var error: String?

  private struct Picked: Identifiable {
    let id = UUID()
    let image: UIImage
    let photo: RemotePhoto
  }

  private var limits: Shared.Limits { Shared.data.limits }
  private var canSend: Bool { (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty) && !sending && model.isOpen }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let error { Notice(tone: .danger, message: error) }
      if !photos.isEmpty { strip }
      capsule
    }
    .padding(.horizontal, Metric.margin)
    .padding(.bottom, 4)
    .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: max(1, limits.photos - photos.count), matching: .images)
    .onChange(of: picked) { _, items in
      guard !items.isEmpty else { return }
      picked = []
      Task { await add(items) }
    }
    .fullScreenCover(isPresented: $shooting) {
      Camera { image in Task { await addImages([image]) } }.ignoresSafeArea()
    }
  }

  private var capsule: some View {
    HStack(alignment: .bottom, spacing: 2) {
      attach
      TextField(model.isOpen ? "回复" : "连上 Mac 后才能发送", text: $text, axis: .vertical)
        .font(.ui(.body))
        .lineLimit(1...6)
        .foregroundStyle(Color.textPrimary)
        .padding(.leading, 4)
        .padding(.trailing, 8)
        .padding(.vertical, 12)
        .disabled(!model.isOpen)
      round
    }
    .padding(4)
    .glass(Metric.radiusField)
  }

  private var attach: some View {
    Menu {
      Button { shooting = true } label: { Label { Text("拍照") } icon: { Icon("camera", size: 20) } }
      Button { picking = true } label: { Label { Text("照片") } icon: { Icon("image", size: 20) } }
    } label: {
      Icon("plus", size: 20).foregroundStyle(Color.textPrimary).frame(width: 42, height: 42)
    }
    .disabled(photos.count >= limits.photos || !model.isOpen)
    .opacity(model.isOpen ? 1 : 0.4)
    .accessibilityLabel("加照片")
  }

  /// Send when there is something to send (or the agent is idle), stop while it runs.
  private var round: some View {
    let sends: Bool = canSend || !running || !model.isOpen
    let idle: Bool = (!canSend && !running) || !model.isOpen
    return Button {
      if sends { send() } else { stop() }
    } label: {
      Group {
        if sends { Icon("arrow-up", size: 20) } else { RoundedRectangle(cornerRadius: 2.5).frame(width: 12, height: 12) }
      }
      .foregroundStyle(Color.solidOn)
      .frame(width: 42, height: 42)
      .background(Color.solidFill, in: Circle())
    }
    .buttonStyle(.plain)
    .opacity(idle ? 0.3 : 1.0)
    .disabled(idle)
    .accessibilityLabel(Text(sends ? "发送" : "停止"))
  }

  private var strip: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(photos) { p in
          Image(uiImage: p.image).resizable().scaledToFill().frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: Metric.radiusControl))
            .overlay(alignment: .topTrailing) {
              Button { photos.removeAll { $0.id == p.id } } label: {
                Icon("x", size: 12).foregroundStyle(Color.textPrimary).frame(width: 22, height: 22).background(Color.bgSheet, in: Circle())
              }
              .padding(4)
              .accessibilityLabel("移除照片")
            }
        }
      }
      .padding(.horizontal, 4)
    }
  }

  private func add(_ items: [PhotosPickerItem]) async {
    var images: [UIImage] = []
    for item in items {
      if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) { images.append(image) }
    }
    await addImages(images)
  }

  /// Long edge 2048 px, JPEG: plenty for an agent to read a screenshot, a few MB for six, and no EXIF.
  private func addImages(_ images: [UIImage]) async {
    var tooBig = false
    for image in images where photos.count < limits.photos {
      let scale = min(1, 2048 / max(image.size.width * image.scale, image.size.height * image.scale))
      let size = CGSize(width: (image.size.width * image.scale * scale).rounded(), height: (image.size.height * image.scale * scale).rounded())
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      let redrawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
      guard let jpeg = redrawn.jpegData(compressionQuality: 0.85) else { continue }
      if jpeg.count > limits.photoBytes {
        tooBig = true
        continue
      }
      photos.append(Picked(image: redrawn, photo: RemotePhoto(name: "photo-\(Int(Date().timeIntervalSince1970 * 1000))-\(photos.count).jpg", data: jpeg.base64EncodedString())))
    }
    error = tooBig ? "有一张照片超过 10 MB，没有加上" : nil
  }

  private func send() {
    guard canSend else { return }
    sending = true
    error = nil
    // On screen and out of the field at once; the Mac may take a while (it starts an agent that has not started).
    let (sentText, sentPhotos) = (text, photos)
    let pending = model.willSend(session, text: sentText, photos: sentPhotos.count)
    text = ""
    photos = []
    Task {
      let result = await model.call(.send(session: session, text: sentText, photos: sentPhotos.map(\.photo)))
      sending = false
      if let failure = result.error {
        model.failedToSend(session, id: pending)
        error = "没有发出去：\(failure)"
        // Back where it was, to send again.
        if text.isEmpty { text = sentText }
        if photos.isEmpty { photos = sentPhotos }
      }
    }
  }

  private func stop() {
    Task { if let failure = await model.call(.interrupt(session: session)).error { error = failure } }
  }
}

/// The system camera, one photo.
private struct Camera: UIViewControllerRepresentable {
  let onPhoto: (UIImage) -> Void
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let parent: Camera
    init(_ parent: Camera) { self.parent = parent }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
      if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
      parent.dismiss()
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
  }
}
