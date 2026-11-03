import Foundation

struct HostIdentity: Decodable, Equatable {
  let udid: String
  let pid: Int
  let label: String
  let source: String
  let bundle: String
  let hostSource: String
}
struct HostGrant: Decodable {
  let version: Int
  let kind: String
  let session: String
  let challenge: String
  let issuedAt: Double
  let expiresAt: Double
  let phase: String
  let openAt: Double?
  let identity: HostIdentity?
  let fingerprint: String?
}
final class NoRedirect: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
/// Trusted CI host owns this ephemeral bearer/session. Plain replies contain
/// independently measured facts, never a runner-authored process assertion.
/// No cookies/proxy/credential persistence, redirects or exported bearer.
final class ReplayHostClient {
  let url: URL
  let sessionID: String
  let bearer: String
  let hostSource: String
  let device: String
  let session: URLSession
  let delegate = NoRedirect()
  var identity: HostIdentity?
  var consumed = false
  var lastReceiptUptime: TimeInterval = 0
  init(environment: [String: String]) throws {
    guard let endpoint = environment["LO_REPLAY_CONTROL"],
          let components = URLComponents(string: endpoint), components.scheme == "http",
          components.host == "127.0.0.1", components.port != nil, components.path == "/rpc",
          components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
          let url = components.url, let id = environment["LO_REPLAY_SESSION"],
          let bearer = environment["LO_REPLAY_BEARER"], !bearer.isEmpty,
          let source = environment["LO_REPLAY_RUNNER_SOURCE"], source.count == 40,
          let device = environment["SIMULATOR_UDID"], !device.isEmpty else { throw ReplayGuardFailure.refused }
    self.url = url; self.sessionID = id; self.bearer = bearer; self.hostSource = source; self.device = device
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil; configuration.connectionProxyDictionary = [:]
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.timeoutIntervalForRequest = 100; configuration.timeoutIntervalForResource = 100
    self.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
  }
  deinit { session.invalidateAndCancel() }
  static func decoded(_ data: Data) throws -> HostGrant {
    guard data.count <= 8192,
          let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys) == Set(["version", "kind", "session", "challenge", "issuedAt", "expiresAt", "phase", "openAt", "identity", "fingerprint"]) else { throw ReplayGuardFailure.refused }
    return try JSONDecoder().decode(HostGrant.self, from: data)
  }
  func request(_ kind: String, observation: PromptObservation? = nil) async throws -> HostGrant {
    let challenge = (0..<32).map { _ in UInt8.random(in: 0...255) }.map { String(format: "%02x", $0) }.joined()
    var object: [String: Any] = ["session": sessionID, "kind": kind, "challenge": challenge]
    if let observation = observation { object["observation"] = observation.object }
    var request = URLRequest(url: url); request.httpMethod = "POST"
    request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: object)
    guard request.httpBody!.count <= 8192 else { throw ReplayGuardFailure.refused }
    let (data, response) = try await session.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, response.url == url else { throw ReplayGuardFailure.refused }
    let grant = try Self.decoded(data)
    lastReceiptUptime = ProcessInfo.processInfo.systemUptime
    let now = Date().timeIntervalSince1970 * 1000
    let expected = kind == "before-observe" ? "query" : kind == "authorize-tap" ? "tap" : kind
    guard grant.version == 1, grant.phase == "seed", grant.session == sessionID,
          grant.challenge == challenge, grant.issuedAt <= now, now < grant.expiresAt,
          now - grant.issuedAt <= 2000,
          grant.kind == expected || (kind == "observed" && ["observed", "observe-complete"].contains(grant.kind)) || (kind == "after-tap" && grant.kind == "terminal") else { throw ReplayGuardFailure.refused }
    if let measured = grant.identity {
      guard measured.udid == device, measured.pid > 0, measured.source == ReplayGuards.source,
            measured.bundle == ReplayGuards.bundle, measured.hostSource == hostSource else { throw ReplayGuardFailure.refused }
      if let prior = identity, prior != measured { throw ReplayGuardFailure.refused }
      identity = measured
    } else if kind != "runner-ready" { throw ReplayGuardFailure.refused }
    return grant
  }
  func useQuery(_ grant: HostGrant) throws {
    try ReplayGuards.permit(grant, session: sessionID, kind: "query",
                           identity: identity, received: lastReceiptUptime)
  }
  func consume(_ grant: HostGrant, observation: PromptObservation) throws {
    guard !consumed else { throw ReplayGuardFailure.refused }
    // A failed attempt also consumes the sole local entitlement; no retry path.
    consumed = true
    try ReplayGuards.permit(grant, session: sessionID, kind: "tap",
                           identity: identity, received: lastReceiptUptime)
    guard grant.fingerprint == observation.fingerprint else { throw ReplayGuardFailure.refused }
  }
}
