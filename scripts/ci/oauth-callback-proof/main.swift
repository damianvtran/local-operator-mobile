import AuthenticationServices
import Foundation
import Network
import UIKit

// Synthetic provider and receipts only. This executable shares the production
// transport source, rather than replacing browser delivery with a JS promise.
final class ProofDelegate: UIResponder, UIApplicationDelegate, ASWebAuthenticationPresentationContextProviding {
  var window: UIWindow?
  let transport = LoopbackAuthSession()
  var provider: NWListener?
  var legacy: ASWebAuthenticationSession?
  var rejected = 0
  var served = false
  var completed = false
  var providerConnections: [NWConnection] = []
  let mode = ProcessInfo.processInfo.environment["PROOF_MODE"] ?? "positive"
  let label = UILabel()

  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    label.frame = CGRect(x: 20, y: 150, width: 350, height: 160)
    label.numberOfLines = 0
    label.text = "Synthetic OAuth callback proof"
    label.accessibilityIdentifier = "proof.status"
    controller.view.addSubview(label)
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    transport.timeoutSeconds = mode == "timeout" ? 8 : 45
    transport.onRejectedRequest = { self.rejected += 1 }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.start() }
    return true
  }

  func start() {
    do {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
      let provider = try NWListener(using: parameters)
      self.provider = provider
      provider.newConnectionHandler = { connection in
        self.providerConnections.append(connection)
        connection.start(queue: .main)
        self.receiveProvider(connection, bytes: Data())
      }

      provider.stateUpdateHandler = { state in
        if case .ready = state { self.prepare() }
        if case .failed = state { self.record(false, detail: "provider-bind-failed") }
      }
      provider.start(queue: .main)
    } catch { record(false, detail: "provider-bind-failed") }
  }

  func receiveProvider(_ connection: NWConnection, bytes: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192 - bytes.count) { chunk, _, complete, error in
      var data = bytes
      if let chunk { data.append(chunk) }
      guard data.range(of: Data("\r\n\r\n".utf8)) != nil else {
        if data.count >= 8192 || complete || error != nil { connection.cancel() }
        else { self.receiveProvider(connection, bytes: data) }
        return
      }
      guard let request = String(data: data, encoding: .utf8),
            let target = request.components(separatedBy: " ").dropFirst().first,
            let parts = URLComponents(string: "http://127.0.0.1\(target)"),
            let redirect = parts.queryItems?.first(where: { $0.name == "redirect_uri" })?.value else { return }
      if target.hasPrefix("/wait?") { return }
      self.served = true
      let good = "\(redirect)?code=synthetic-only&state=proof-state"
      let bad = "\(redirect)?code=synthetic-attacker&state=wrong-state"
      // Browser GETs the wrong state first. Even though CORS hides its response,
      // the HTTP request reaches the native listener. Only the second GET may finish.
      let body = self.mode == "positive"
        ? "<script>fetch('\(bad)').catch(()=>{}).finally(()=>{location.href='\(good)'});</script>"
        : "<script>location.href='\(good)'</script>"
      let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
      connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
    }
  }

  func prepare() {
    transport.prepare { result in
      guard case .success(let redirect) = result, let port = self.provider?.port else {
        self.record(false, detail: "callback-bind-failed"); return
      }
      var authorize = URLComponents(string: "http://127.0.0.1:\(port.rawValue)/authorize")!
      authorize.queryItems = [URLQueryItem(name: "redirect_uri", value: redirect.absoluteString), URLQueryItem(name: "state", value: "proof-state")]
      if self.mode == "legacy" {
        // Same boundary as shipped Expo: HTTP callback scheme, no HTTP listener.
        self.transport.cancel()
        let session = ASWebAuthenticationSession(url: authorize.url!, callbackURLScheme: "http") { callback, _ in
          if callback != nil { DispatchQueue.main.async { self.record(false, detail: "legacy-unexpected-callback") } }
        }
        session.presentationContextProvider = self
        self.legacy = session
        guard session.start() else { self.record(false, detail: "legacy-start-failed"); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
          if !self.completed { self.legacy?.cancel(); self.record(self.served, detail: "legacy-http-callback-not-delivered") }
        }
        return
      }
      if self.mode == "timeout" || self.mode == "cancel" {
        self.transport.open(url: URL(string: "http://127.0.0.1:\(port.rawValue)/wait?redirect_uri=\(redirect.absoluteString)&state=proof-state")!, redirect: redirect) { result in
          if self.mode == "cancel", case .success(nil) = result { self.assertClosed(redirect, detail: "cancel-cleanup", pass: true) }
          else if self.mode == "timeout", case .failure = result { self.assertClosed(redirect, detail: "timeout-cleanup", pass: true) }
          else { self.record(false, detail: "timeout-unexpected-result") }
        }
        if self.mode == "cancel" {
          DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.transport.cancel() }
        }
        // /wait intentionally receives no response, leaving the system sheet open.
        return
      }
      self.transport.open(url: authorize.url!, redirect: redirect) { result in
        if case .success(let callback?) = result {
          let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value
          self.assertClosed(redirect, detail: "browser-native-callback", pass: code == "synthetic-only" && self.rejected == 1 && self.served)
        } else { self.record(false, detail: "positive-callback-failed") }
      }
    }
  }

  func assertClosed(_ redirect: URL, detail: String, pass: Bool) {
    // Prove a late callback cannot reach a listener left behind by success/cancel/timeout.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
      let connection = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(redirect.port!))!, using: .tcp)
      connection.stateUpdateHandler = { state in
        switch state {
        case .failed(let error):
          connection.cancel()
          if case .posix(.ECONNREFUSED) = error { self.record(pass, detail: detail) }
          else { self.record(false, detail: "unexpected-network-error") }
        case .ready:
          connection.cancel()
          self.record(false, detail: "listener-left-open")
        default: break
        }
      }
      connection.start(queue: .main)
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        connection.cancel()
        if !self.completed { self.record(false, detail: "listener-close-check-timeout") }
      }
    }
  }

  func record(_ pass: Bool, detail: String) {
    guard !completed else { return }
    completed = true
    provider?.cancel()
    providerConnections.forEach { $0.cancel() }
    let receipt: [String: Any] = ["mode": mode, "pass": pass, "detail": detail, "rejected": rejected, "provider_served": served]
    let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("receipt.json")
    try? JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: path)
    label.text = pass ? "PASS \(mode)" : "FAIL \(mode): \(detail)"
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window! }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(ProofDelegate.self))
