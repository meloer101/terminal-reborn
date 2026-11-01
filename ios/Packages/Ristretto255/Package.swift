// swift-tools-version: 6.0
// The ristretto255 group of libsodium 1.0.20 (ISC, LICENSE-libsodium) for the iPhone app's typed-code PAKE (PRD F22):
// the source files of the group and nothing else. swift-sodium's prebuilt libsodium is the minimal build, which leaves
// ristretto255 out, and CryptoKit has no such group.
import PackageDescription

let package = Package(
  name: "Ristretto255",
  platforms: [.iOS("26.0")],
  products: [.library(name: "CRistretto255", targets: ["CRistretto255"])],
  targets: [
    .target(
      name: "CRistretto255",
      cSettings: [
        .headerSearchPath("sodium"),
        // Built from these files rather than libsodium's configure script; WaviTests/CryptoTests.swift checks the result
        // byte for byte against the Mac (src/shared/remote-vectors.json).
        .define("CONFIGURED", to: "1"),
        .define("HAVE_TI_MODE", to: "1"),
        .define("NATIVE_LITTLE_ENDIAN", to: "1"),
        .define("__STDC_WANT_LIB_EXT1__", to: "1"),
        .unsafeFlags(["-Wno-unused-function"])
      ]
    )
  ]
)
