import Foundation
import CryptoKit
import Darwin

/** Shared by the Expo module and dependency-free native tests. Read-back is
 * visibility, NOT durability: atomic rename/unlink and directory creation need
 * a containing-directory barrier as well as an fsynced file. Any failed
 * barrier propagates before native success/readiness; there is no best-effort
 * persistence path. A durable initialization witness prevents a lost index
 * from being mistaken for a new empty store with no foreign claims.
 */
final class NotificationSoundStore {
  struct Entry: Codable { let bytes: Int; var used: Double }
  struct State: Codable {
    var entries: [String: Entry] = [:]
    var claims: [String: [String]] = [:]
  }
  enum Failure: Error { case invalid, limit, lostIndex, inconsistent, notDurable }
  typealias Barrier = (URL, Bool) throws -> Void
  let root: URL
  private let barrier: Barrier
  private let fm = FileManager.default
  private var index: URL { root.appendingPathComponent("lop-notification-sounds.json") }
  private var witness: URL { root.appendingPathComponent("lop-notification-sounds.initialized") }
  private var directory: URL { root.appendingPathComponent("Sounds", isDirectory: true) }
  private let witnessBytes = Data("lop-notification-sounds-v1\n".utf8)

  init(root: URL, barrier: @escaping Barrier = NotificationSoundStore.synchronize) {
    self.root = root.resolvingSymlinksInPath()
    self.barrier = barrier
  }
  static func synchronize(_ url: URL, _ directory: Bool) throws {
    let fd = Darwin.open(url.path, O_RDONLY | (directory ? O_DIRECTORY : 0))
    guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    // Preserve the actual fsync errno; close errors must not hide it.
    if Darwin.fsync(fd) != 0 {
      let code = POSIXErrorCode(rawValue: errno) ?? .EIO
      _ = Darwin.close(fd)
      throw POSIXError(code)
    }
    guard Darwin.close(fd) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
  }
  static func hash(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  func stem(_ sha: String) throws -> String {
    guard sha.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.invalid }
    return "c_" + sha.prefix(16)
  }
  func sound(_ sha: String) throws -> URL { try directory.appendingPathComponent(stem(sha) + ".wav") }
  private func ensureDirectory(_ url: URL) throws {
    var isDir: ObjCBool = false
    if fm.fileExists(atPath: url.path, isDirectory: &isDir) {
      guard isDir.boolValue else { throw Failure.invalid }
      // A prior process may have failed after mkdir but before its barrier.
      try barrier(url.deletingLastPathComponent(), true)
      return
    }
    try ensureDirectory(url.deletingLastPathComponent())
    try fm.createDirectory(at: url, withIntermediateDirectories: false)
    try barrier(url.deletingLastPathComponent(), true)
  }
  private func durableWrite(_ bytes: Data, _ url: URL) throws {
    try bytes.write(to: url, options: .atomic)
    try barrier(url, false)
    try barrier(url.deletingLastPathComponent(), true)
  }
  private func save(_ value: State) throws { try durableWrite(JSONEncoder().encode(value), index) }
  private func state() throws -> State {
    try ensureDirectory(root)
    let hasIndex = fm.fileExists(atPath: index.path)
    let hasWitness = fm.fileExists(atPath: witness.path)
    if !hasIndex {
      let files = fm.fileExists(atPath: directory.path) ? try fm.contentsOfDirectory(atPath: directory.path) : []
      guard !hasWitness && files.isEmpty else { throw Failure.lostIndex }
      // Witness first: interruption before initial index commit fails closed,
      // rather than silently initialize after an acknowledged store was lost.
      try durableWrite(witnessBytes, witness)
      try save(State())
    }
    let value = try JSONDecoder().decode(State.self, from: Data(contentsOf: index))
    guard value.entries.count <= 5,
      value.entries.values.allSatisfy({ (1...2097152).contains($0.bytes) }),
      value.entries.values.reduce(0, { $0 + $1.bytes }) <= 8388608,
      value.claims.values.flatMap({ $0 }).allSatisfy({ value.entries[$0] != nil }) else { throw Failure.inconsistent }
    for sha in value.entries.keys { _ = try stem(sha) }
    if hasWitness {
      guard try Data(contentsOf: witness) == witnessBytes else { throw Failure.inconsistent }
    } else {
      // Preserve a pre-witness index and ALL claims; never migrate by reset.
      try durableWrite(witnessBytes, witness)
    }
    // Retry barriers after a prior process failed following rename. Current
    // visibility alone may not authorize a later readiness report either.
    try barrier(witness, false)
    try barrier(index, false)
    try barrier(root, true)
    return value
  }
  func inventory() throws -> [[String: Any]] {
    let value = try state()
    return try value.entries.map { sha, row in
      ["sha": sha, "bytes": row.bytes, "used": row.used, "valid": try valid(sha, row)]
    }
  }
  private func valid(_ sha: String, _ row: Entry) throws -> Bool {
    let file = try sound(sha)
    guard fm.fileExists(atPath: file.path) else { return false }
    let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize
    guard size == row.bytes else { return false }
    try barrier(file, false)
    try barrier(directory, true)
    return try Self.hash(Data(contentsOf: file)) == sha
  }
  func claims() throws -> [String: [String]] { try state().claims }
  func claim(_ owner: String, _ shas: [String]) throws {
    guard (1...128).contains(owner.count), shas.count <= 10 else { throw Failure.invalid }
    var value = try state()
    for sha in shas { _ = try stem(sha); guard value.entries[sha] != nil else { throw Failure.inconsistent } }
    value.claims[owner] = shas.isEmpty ? nil : shas
    try save(value)
  }
  func touch(_ sha: String, _ used: Double) throws {
    _ = try stem(sha)
    var value = try state()
    guard value.entries[sha] != nil else { throw Failure.invalid }
    value.entries[sha]?.used = used
    try save(value)
  }
  func install(_ sha: String, _ bytes: Data, _ used: Double) throws {
    let name = try stem(sha)
    guard (1...2097152).contains(bytes.count), Self.hash(bytes) == sha else { throw Failure.invalid }
    var value = try state()
    guard value.entries[sha] == nil, value.entries.count < 5,
      bytes.count + value.entries.values.reduce(0, { $0 + $1.bytes }) <= 8388608,
      try !value.entries.keys.contains(where: { try stem($0) == name }) else { throw Failure.limit }
    try ensureDirectory(directory)
    value.entries[sha] = Entry(bytes: bytes.count, used: used)
    try save(value)
    try durableWrite(bytes, sound(sha))
    guard try valid(sha, value.entries[sha]!) else { throw Failure.notDurable }
  }
  func remove(_ sha: String) throws {
    var value = try state()
    guard !value.claims.values.contains(where: { $0.contains(sha) }) else { throw Failure.invalid }
    let file = try sound(sha)
    if fm.fileExists(atPath: file.path) { try fm.removeItem(at: file) }
    // Also retry the barrier when an earlier unlink succeeded but its barrier
    // failed: absence does not prove that unlink was durably acknowledged.
    if fm.fileExists(atPath: directory.path) { try barrier(directory, true) }
    value.entries.removeValue(forKey: sha)
    try save(value)
  }
}
