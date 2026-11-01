// The input under a conversation (Figma 45C / 45G, 46′): one glass capsule — photos from the camera or the library (up
// to six), the text field, and one round button: send when there is something to send, stop (Esc) while the agent
// runs. Photos are drawn again as JPEG on the phone before they go: that drops their EXIF, location included.
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
  private var canSend: Bool { (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty) && !sending }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let error { Text(error).font(.ui(13)).foregroundStyle(Color.statusError).padding(.leading, 16) }
      if !photos.isEmpty { strip }
      capsule
    }
    .padding(.horizontal, 12)
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
      TextField("回复…", text: $text, axis: .vertical)
        .font(.ui(16))
        .lineLimit(1...6)
        .foregroundStyle(Color.textPrimary)
        .padding(.leading, 8)
        .padding(.trailing, 16)
        .padding(.vertical, 12)
      round
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .glass(28)
  }

  private var attach: some View {
    Menu {
      Button { shooting = true } label: { Label { Text("拍照") } icon: { Icon("camera", size: 20) } }
      Button { picking = true } label: { Label { Text("照片") } icon: { Icon("image", size: 20) } }
    } label: {
      Icon("image", size: 20).foregroundStyle(Color.textSecondary).frame(width: 36, height: 36)
    }
    .disabled(photos.count >= limits.photos)
    .padding(.bottom, 5)
    .accessibilityLabel("加照片")
  }

  /// Send when there is something to send (or the agent is idle), stop while it runs.
  private var round: some View {
    let sends: Bool = canSend || !running
    let idle: Bool = !canSend && !running
    return Button {
      if sends { send() } else { stop() }
    } label: {
      Icon(sends ? "arrow-up" : "square", size: 22)
        .foregroundStyle(Color.textInverse)
        .frame(width: 40, height: 40)
        .background(Color.fillPrimary, in: Circle())
    }
    .buttonStyle(.plain)
    .opacity(idle ? 0.3 : 1.0)
    .disabled(idle)
    .padding(.bottom, 3)
    .accessibilityLabel(Text(sends ? "发送" : "停止"))
  }

  private var strip: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(photos) { p in
          Image(uiImage: p.image).resizable().scaledToFill().frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) {
              Button { photos.removeAll { $0.id == p.id } } label: {
                Icon("x", size: 12).foregroundStyle(Color.textPrimary).padding(3).background(Color.bgApp, in: Circle())
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
    error = tooBig ? "有照片超过 10 MB，没有加上" : nil
  }

  private func send() {
    guard canSend else { return }
    sending = true
    error = nil
    Task {
      let result = await model.call(.send(session: session, text: text, photos: photos.map(\.photo)))
      sending = false
      if let failure = result.error {
        error = failure
        return
      }
      text = ""
      photos = []
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
