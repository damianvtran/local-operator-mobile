import XCTest
@testable import LopNotificationSoundStore

final class NotificationSoundStoreTests: XCTestCase {
  let bytes = Data([1, 2, 3, 4])
  func fixture() throws -> URL {
    let parent = ProcessInfo.processInfo.environment["LOP_NATIVE_TEST_ROOT"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let root = parent.appendingPathComponent("sound-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    addTeardownBlock { try FileManager.default.removeItem(at: root) }
    return root.resolvingSymlinksInPath()
  }
  func testFileAndDirectoryOrdering() throws {
    let root = try fixture(); var events: [(URL, Bool)] = []
    let store = NotificationSoundStore(root: root) { url, dir in
      events.append((url, dir)); try NotificationSoundStore.synchronize(url, dir)
    }
    let sha = NotificationSoundStore.hash(bytes)
    try store.install(sha, bytes, 1); try store.claim("foreign", [sha])
    let index = root.appendingPathComponent("lop-notification-sounds.json")
    let sound = try store.sound(sha)
    try requirePublication(events, sound); try requirePublication(events, index)
    XCTAssertTrue(events.contains { $0.0.path == root.path && $0.1 })
    try store.claim("foreign", [])
    events.removeAll(); try store.remove(sha)
    XCTAssertTrue(events.contains { $0.0.path == root.appendingPathComponent("Sounds").path && $0.1 })
    try requirePublication(events, index)
  }
  private func requirePublication(_ events: [(URL, Bool)], _ file: URL) throws {
    guard let at = events.lastIndex(where: { $0.0.path == file.path && !$0.1 }),
      events.dropFirst(at + 1).contains(where: { $0.0.path == file.deletingLastPathComponent().path && $0.1 }) else {
      throw NotificationSoundStore.Failure.notDurable
    }
  }
  func testOldControlFailsPublicationAudit() throws {
    let root = try fixture(); let file = root.appendingPathComponent("old-control")
    // Reproduce the old native helper: atomic write + file fsync, no directory
    // barrier. This is a real IO/ordering negative control, not power-loss proof.
    try bytes.write(to: file, options: .atomic)
    try NotificationSoundStore.synchronize(file, false)
    XCTAssertThrowsError(try requirePublication([(file, false)], file))
  }
  func testSoundBarrierFailureNeverAcknowledgesCommit() throws {
    let root = try fixture(); let base = NotificationSoundStore(root: root)
    _ = try base.inventory()
    let sha = NotificationSoundStore.hash(bytes)
    var reject = true
    let store = NotificationSoundStore(root: root) { url, dir in
      if reject && dir && url.lastPathComponent == "Sounds" { throw POSIXError(.EIO) }
      try NotificationSoundStore.synchronize(url, dir)
    }
    var nativeAcknowledged = false
    do { try store.install(sha, bytes, 1); nativeAcknowledged = true } catch { XCTAssertEqual((error as? POSIXError)?.code, .EIO) }
    XCTAssertFalse(nativeAcknowledged) // JS's awaited native commit must reject.
    // Fresh native owner retries real barriers before returning valid inventory.
    reject = false
    let reopened = NotificationSoundStore(root: root)
    XCTAssertEqual(try reopened.inventory().first?["valid"] as? Bool, true)
    XCTAssertEqual(try reopened.claims(), [:])
  }
  func testIndexBarrierFailurePropagatesAndClaimsAreNotReset() throws {
    let root = try fixture(); let base = NotificationSoundStore(root: root)
    let sha = NotificationSoundStore.hash(bytes)
    try base.install(sha, bytes, 1); try base.claim("foreign", [sha])
    var writingIndex = false
    let broken = NotificationSoundStore(root: root) { url, dir in
      // state() first synchronizes the existing index; fail only the post-write
      // directory barrier after its SECOND file barrier (the claim replacement).
      if url.lastPathComponent == "lop-notification-sounds.json" && !dir {
        writingIndex.toggle()
      }
      if dir && url.path == root.path && !writingIndex { throw POSIXError(.EIO) }
      try NotificationSoundStore.synchronize(url, dir)
    }
    XCTAssertThrowsError(try broken.claim("local", [sha]))
    XCTAssertEqual(try NotificationSoundStore(root: root).claims()["foreign"], [sha])
  }
  func testRemovalBarrierFailureRetainsAccountingAndRejectsSuccess() throws {
    let root = try fixture(); let base = NotificationSoundStore(root: root)
    let sha = NotificationSoundStore.hash(bytes); try base.install(sha, bytes, 1)
    let broken = NotificationSoundStore(root: root) { url, dir in
      if dir && url.lastPathComponent == "Sounds" { throw POSIXError(.EIO) }
      try NotificationSoundStore.synchronize(url, dir)
    }
    XCTAssertThrowsError(try broken.remove(sha))
    XCTAssertEqual(try base.inventory().count, 1)
    XCTAssertEqual(try base.inventory().first?["valid"] as? Bool, false)
    try base.remove(sha); XCTAssertTrue(try base.inventory().isEmpty)
  }
  func testAtomicPublicationFailureDoesNotAcknowledge() throws {
    let root = try fixture(); let store = NotificationSoundStore(root: root)
    _ = try store.inventory()
    let sha = NotificationSoundStore.hash(bytes)
    // An existing directory at the destination forces Foundation's atomic
    // publication/rename to fail; the reserved index is not a ready sound.
    try FileManager.default.createDirectory(at: store.sound(sha), withIntermediateDirectories: true)
    XCTAssertThrowsError(try store.install(sha, bytes, 1))
    XCTAssertEqual(try store.inventory().first?["valid"] as? Bool, false)
    XCTAssertEqual(try store.claims(), [:])
  }
  func testInitializationBarrierFailureCannotResetState() throws {
    let root = try fixture()
    let broken = NotificationSoundStore(root: root) { url, dir in
      if dir && url.path == root.path { throw POSIXError(.EIO) }
      try NotificationSoundStore.synchronize(url, dir)
    }
    XCTAssertThrowsError(try broken.inventory())
    XCTAssertThrowsError(try NotificationSoundStore(root: root).claims())
  }
  func testMissingOrCorruptIndexFailsClosed() throws {
    let root = try fixture(); let store = NotificationSoundStore(root: root)
    let sha = NotificationSoundStore.hash(bytes)
    try store.install(sha, bytes, 1); try store.claim("foreign", [sha])
    let index = root.appendingPathComponent("lop-notification-sounds.json")
    try FileManager.default.removeItem(at: index)
    XCTAssertThrowsError(try NotificationSoundStore(root: root).claims())
    try Data("{\"entries\":{}}".utf8).write(to: index, options: .atomic)
    XCTAssertThrowsError(try NotificationSoundStore(root: root).inventory())
  }
}

/** CI invokes these filters in TWO distinct test-runner processes against the
 * same disposable sandbox. No static singleton/fresh Swift object is passed
 * off as process restart. Normal host test execution excludes this class. */
final class ProcessPersistenceTests: XCTestCase {
  private var root: URL {
    let parent = ProcessInfo.processInfo.environment["LOP_NATIVE_TEST_ROOT"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return parent.appendingPathComponent("notification-sound-process-proof")
  }
  func testPhaseAWrite() throws {
    try FileManager.default.createDirectory(at: root.deletingLastPathComponent(), withIntermediateDirectories: true)
    let store = NotificationSoundStore(root: root); let bytes = Data([4, 3, 2, 1])
    let sha = NotificationSoundStore.hash(bytes)
    try store.install(sha, bytes, 9); try store.claim("foreign-restart-proof", [sha])
    try Data(String(ProcessInfo.processInfo.processIdentifier).utf8).write(to: root.appendingPathComponent("writer-pid"), options: .atomic)
  }
  func testPhaseBRead() throws {
    let store = NotificationSoundStore(root: root)
    let sha = NotificationSoundStore.hash(Data([4, 3, 2, 1]))
    let writer = try String(contentsOf: root.appendingPathComponent("writer-pid"), encoding: .utf8)
    XCTAssertNotEqual(writer, String(ProcessInfo.processInfo.processIdentifier))
    XCTAssertEqual(try store.claims()["foreign-restart-proof"], [sha])
    XCTAssertEqual(try store.inventory().first?["valid"] as? Bool, true)
    try store.claim("foreign-restart-proof", []); try store.remove(sha)
    try FileManager.default.removeItem(at: root)
  }
}
