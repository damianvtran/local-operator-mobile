import Foundation

import ExpoModulesCore

/** No native success/readiness until the shared store completes both file and
 * containing-directory barriers. The same store runs in native XCTest; Expo
 * binding is separately compiled by the app's normal iOS CI lane. */
public final class LopNotificationSoundModule: Module {
  private func store() throws -> NotificationSoundStore {
    let root = try FileManager.default.url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
    return NotificationSoundStore(root: root)
  }
  public func definition() -> ModuleDefinition {
    Name("LopNotificationSound")
    AsyncFunction("available") { true }
    AsyncFunction("inventory") { () throws -> [[String: Any]] in try self.store().inventory() }
    AsyncFunction("claims") { () throws -> [String: [String]] in try self.store().claims() }
    AsyncFunction("claim") { (owner: String, shas: [String]) throws in try self.store().claim(owner, shas) }
    AsyncFunction("touch") { (sha: String, used: Double) throws in try self.store().touch(sha, used) }
    AsyncFunction("install") { (sha: String, stage: String, used: Double) throws in
      let expected = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        .appendingPathComponent("lop-notification-sound-stage.wav").resolvingSymlinksInPath()
      guard let source = URL(string: stage), source.isFileURL,
        source.resolvingSymlinksInPath() == expected,
        let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize,
        (1...2097152).contains(size) else { throw NotificationSoundStore.Failure.invalid }
      try self.store().install(sha, Data(contentsOf: source), used)
    }
    AsyncFunction("remove") { (sha: String) throws in try self.store().remove(sha) }
  }
}
