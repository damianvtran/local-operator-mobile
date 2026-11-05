// swift-tools-version: 5.9
import PackageDescription

// No fetched dependencies: XCTest exercises the exact persistence source used
// by the Expo pod, not a test copy or a mock filesystem.
let package = Package(
  name: "LopNotificationSoundStore",
  platforms: [.iOS("16.4"), .macOS(.v13)],
  products: [.library(name: "LopNotificationSoundStore", targets: ["LopNotificationSoundStore"])],
  targets: [
    .target(name: "LopNotificationSoundStore", path: "ios",
      exclude: ["LopNotificationSoundModule.swift", "LopNotificationSound.podspec"],
      sources: ["NotificationSoundStore.swift"]),
    .testTarget(name: "LopNotificationSoundStoreTests", dependencies: ["LopNotificationSoundStore"], path: "tests/swift"),
  ]
)
