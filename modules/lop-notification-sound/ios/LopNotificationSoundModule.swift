import CryptoKit
import ExpoModulesCore

/** UNNotificationSound(named:) searches Library/Sounds before the main bundle.
 * Use an atomic native write + fsync rather than claiming readiness from a JS
 * download promise. No service extension or remote background mode is needed;
 * a phone that has not foregrounded still uses the cloud's soft-pulse fallback.
 */
public final class LopNotificationSoundModule: Module {
  struct Entry: Codable { let bytes: Int; var used: Double }
  struct State: Codable {
    var entries: [String: Entry] = [:]
    var claims: [String: [String]] = [:]
  }
  private let fm = FileManager.default
  private var root: URL { get throws {
    try fm.url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
  } }
  private func stem(_ sha: String) throws -> String {
    guard sha.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
      throw SoundError.invalid
    }
    return "c_" + sha.prefix(16)
  }
  private func sound(_ sha: String) throws -> URL {
    let directory = try root.appendingPathComponent("Sounds", isDirectory: true)
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    return try directory.appendingPathComponent(stem(sha) + ".wav")
  }
  private func index() throws -> URL { try root.appendingPathComponent("lop-notification-sounds.json") }
  private func state() throws -> State {
    let url = try index()
    if !fm.fileExists(atPath: url.path) { return State() }
    // An unreadable index is NOT empty: it might carry another computer's
    // outstanding readiness claims. Fail closed instead of deleting its files.
    return try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
  }
  private func durableWrite(_ bytes: Data, _ url: URL) throws {
    try bytes.write(to: url, options: .atomic)
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.synchronize()
  }
  private func save(_ value: State) throws { try durableWrite(JSONEncoder().encode(value), index()) }
  private func hash(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  private func valid(_ sha: String, _ entry: Entry) -> Bool {
    guard let url = try? sound(sha), let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
      values.fileSize == entry.bytes, entry.bytes <= 2097152,
      let bytes = try? Data(contentsOf: url) else { return false }
    return hash(bytes) == sha
  }
  enum SoundError: Error { case invalid, limit, notDurable }

  public func definition() -> ModuleDefinition {
    Name("LopNotificationSound")
    AsyncFunction("available") { true }
    AsyncFunction("inventory") { () throws -> [[String: Any]] in
      try self.state().entries.map { sha, row in
        ["sha": sha, "bytes": row.bytes, "used": row.used, "valid": self.valid(sha, row)]
      }
    }
    AsyncFunction("claims") { () throws -> [String: [String]] in try self.state().claims }
    AsyncFunction("claim") { (owner: String, shas: [String]) throws in
      guard (1...128).contains(owner.count), shas.count <= 10 else { throw SoundError.invalid }
      for sha in shas { _ = try self.stem(sha) }
      var value = try self.state()
      value.claims[owner] = shas.isEmpty ? nil : shas
      try self.save(value)
    }
    AsyncFunction("touch") { (sha: String, used: Double) throws in
      _ = try self.stem(sha)
      var value = try self.state()
      guard value.entries[sha] != nil else { throw SoundError.invalid }
      value.entries[sha]?.used = used
      try self.save(value)
    }
    AsyncFunction("install") { (sha: String, stage: String, used: Double) throws in
      let name = try self.stem(sha)
      let expected = try self.fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("lop-notification-sound-stage.wav").resolvingSymlinksInPath()
      guard let source = URL(string: stage), source.isFileURL,
        source.resolvingSymlinksInPath() == expected,
        let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize,
        (1...2097152).contains(size) else { throw SoundError.invalid }
      let bytes = try Data(contentsOf: source)
      guard self.hash(bytes) == sha else { throw SoundError.invalid }
      var value = try self.state()
      guard value.entries[sha] == nil, value.entries.count < 5,
        bytes.count + value.entries.values.reduce(0, { $0 + $1.bytes }) <= 8388608,
        try !value.entries.keys.contains(where: { try self.stem($0) == name }) else { throw SoundError.limit }
      // Reserve before write: interrupted installs remain accounted for and
      // invalid. The coordinator withdraws before deleting them on its retry.
      value.entries[sha] = Entry(bytes: bytes.count, used: used)
      try self.save(value)
      try self.durableWrite(bytes, self.sound(sha))
      guard self.valid(sha, value.entries[sha]!) else { throw SoundError.notDurable }
    }
    AsyncFunction("remove") { (sha: String) throws in
      var value = try self.state()
      guard !value.claims.values.contains(where: { $0.contains(sha) }) else { throw SoundError.invalid }
      let file = try self.sound(sha)
      if self.fm.fileExists(atPath: file.path) { try self.fm.removeItem(at: file) }
      value.entries.removeValue(forKey: sha)
      try self.save(value)
    }
  }
}
