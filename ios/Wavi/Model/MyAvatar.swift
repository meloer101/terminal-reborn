// My avatar in the conversation (Figma 64A / 64G): a picture chosen on this phone, kept only on this phone. Cut to the
// middle square and drawn again at 256 px as JPEG, which drops its EXIF (location included).
import Observation
import UIKit

/// The middle square of an image `size` big.
func squareCrop(_ size: CGSize) -> CGRect {
  let side = min(size.width, size.height)
  return CGRect(x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side)
}

@MainActor @Observable
final class MyAvatar {
  static let shared = MyAvatar()
  nonisolated static let side: CGFloat = 256

  private(set) var image: UIImage?

  private static var file: URL {
    URL.applicationSupportDirectory.appending(path: "my-avatar.jpg")
  }

  private init() {
    image = (try? Data(contentsOf: Self.file)).flatMap(UIImage.init(data:))
  }

  /// Keeps `data` (any picture the system reads) as the avatar; false when it is not a picture or cannot be kept.
  /// Decoding and drawing a full-size photo happen off the main thread.
  func set(_ data: Data) async -> Bool {
    let jpeg = await Task.detached(priority: .userInitiated) { () -> Data? in
      guard let source = UIImage(data: data) else { return nil }
      return Self.square(source).jpegData(compressionQuality: 0.85)
    }.value
    guard let jpeg else { return false }
    do {
      try FileManager.default.createDirectory(at: Self.file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try jpeg.write(to: Self.file, options: .atomic)
    } catch {
      return false
    }
    image = UIImage(data: jpeg)
    return true
  }

  func remove() {
    try? FileManager.default.removeItem(at: Self.file)
    image = nil
  }

  nonisolated private static func square(_ image: UIImage) -> UIImage {
    let crop = squareCrop(image.size)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
      let scale = side / crop.width
      image.draw(in: CGRect(x: -crop.minX * scale, y: -crop.minY * scale, width: image.size.width * scale, height: image.size.height * scale))
    }
  }
}
