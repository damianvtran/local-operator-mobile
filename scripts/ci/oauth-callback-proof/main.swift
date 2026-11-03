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
  let runId = ProcessInfo.processInfo.environment["PROOF_RUN_ID"] ?? UUID().uuidString
  var probeControlOpen = "not-run"
  var probeControlClosed = "not-run"
  var closeProbe = "not-run"
  let label = UILabel()
  let startButton = UIButton(type: .system)
  var started = false
  var stage = "fixture-starting"
  var startedAt: Date?
  var providerAt: Date?
  var callbackAt: Date?
  var nativePreparedAt: Date?

  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    label.frame = CGRect(x: 20, y: 150, width: 350, height: 160)
    label.numberOfLines = 0
    label.text = "Preparing fixture \(mode)"
    label.accessibilityIdentifier = "proof.status"
    controller.view.addSubview(label)
    startButton.frame = CGRect(x: 20, y: 330, width: 350, height: 60)
    startButton.setTitle("Start \(mode)", for: .normal)
    startButton.isEnabled = false
    startButton.accessibilityIdentifier = "proof.start"
    startButton.addTarget(self, action: #selector(start), for: .touchUpInside)
    controller.view.addSubview(startButton)
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    // Launch is deliberately inert. Maestro must be fully running and observe
    // Ready before it taps Start; UI-driver cold start is not an auth timeout.
    transport.onRejectedRequest = { self.rejected += 1 }
    persist()
    bindProvider() // Fixture control only: no auth listener/session/deadline.
    return true
  }

  @objc func start() {
    guard !started else { return }
    started = true
    startedAt = Date()
    let control = TCPClosureProbe.negativeControl()
    probeControlOpen = control.open.label
    probeControlClosed = control.closed.label
    guard control.open == .open, control.closed == .refused else {
      record(false, detail: "closure-probe-negative-control-failed"); return
    }
    stage = "prepared"
    label.text = "Prepared \(mode)"
    startButton.isHidden = true
    persist()
    // A tap must NOT present a system sheet while Maestro is taking its implicit
    // post-tap screenshot. The running driver's next HTTP control command begins
    // presentation after this stable Prepared state; it carries no OAuth payload.
  }

  func bindProvider() {
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
        if case .ready = state, !self.started {
          self.stage = "ready"
          self.label.text = "Ready \(self.mode)"
          self.startButton.isEnabled = true
          self.persist()
        }
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
            let target = request.components(separatedBy: " ").dropFirst().first else { connection.cancel(); return }
      if target == "/begin" {
        guard self.started, self.stage == "prepared", !self.completed else {
          self.sendProvider(connection, body: "not ready"); return
        }
        self.stage = "browser-starting"
        self.persist()
        self.sendProvider(connection, body: "begin") { self.prepare() }
        return
      }
      guard let parts = URLComponents(string: "http://127.0.0.1\(target)"),
            let redirect = parts.queryItems?.first(where: { $0.name == "redirect_uri" })?.value else { return }
      if !self.served { self.providerAt = Date() }
      self.served = true
      self.stage = "browser-ready"
      self.persist()
      if !target.hasPrefix("/complete?") {
        // A real browser page is an observable readiness barrier before callbacks.
        // The timeout case deliberately leaves the production five-minute timer
        // unchanged; cancel is driven through the system sheet's Cancel control.
        let title = self.mode == "timeout" || self.mode == "cancel"
          ? "Synthetic callback waiting" : "Complete test sign-in"
        let path = "/complete?redirect_uri=\(redirect.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)"
        let body = "<html><body><h1>Browser ready</h1><a href='\(path)'>\(title)</a></body></html>"
        self.sendProvider(connection, body: body)
        return
      }
      self.callbackAt = Date()
      self.stage = "callback-triggered"
      self.persist()
      if self.mode == "legacy" {
        // Count non-delivery only AFTER an observed browser request triggers the
        // callback. This cannot pass merely because consent was never handled.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
          if !self.completed {
            self.legacy?.cancel()
            self.record(self.served && self.callbackAt != nil, detail: "legacy-http-callback-not-delivered")
          }
        }
      }
      let good = "\(redirect)?code=synthetic-only&state=proof-state"
      let bad = "\(redirect)?code=synthetic-attacker&state=wrong-state"
      // Browser GETs the wrong state first. Even though CORS hides its response,
      // the HTTP request reaches the native listener. Only the second GET may finish.
      let body = self.mode == "positive"
        ? "<script>fetch('\(bad)').catch(()=>{}).finally(()=>{location.href='\(good)'});</script>"
        : "<script>location.href='\(good)'</script>"
      self.sendProvider(connection, body: body)
    }
  }

  func sendProvider(_ connection: NWConnection, body: String, afterSend: (() -> Void)? = nil) {
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(body.utf8.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n\(body)"
    connection.send(content: Data(response.utf8), completion: .contentProcessed { error in
      connection.cancel()
      if error == nil { afterSend?() }
    })
  }

  func prepare() {
    // Use the unmodified production timeout, not a fixture timer made longer
    // until a cold UI driver happens to fit. The receipt records its elapsed time.
    nativePreparedAt = Date()
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
        return
      }
      if self.mode == "timeout" || self.mode == "cancel" {
        self.transport.open(url: URL(string: "http://127.0.0.1:\(port.rawValue)/wait?redirect_uri=\(redirect.absoluteString)&state=proof-state")!, redirect: redirect) { result in
          if self.mode == "cancel", case .success(nil) = result { self.assertClosed(redirect, detail: "cancel-cleanup", pass: true) }
          else if self.mode == "timeout", case .failure = result {
            let elapsed = Date().timeIntervalSince(self.nativePreparedAt ?? Date())
            self.assertClosed(redirect, detail: "timeout-cleanup", pass: self.served && elapsed >= 295 && elapsed < 330)
          }
          else { self.record(false, detail: "timeout-unexpected-result") }
        }
        // The browser serves a waiting page; Maestro photographs it before
        // Cancel or the real production timer, rather than racing an auto-cancel.
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
    // Probe actual connect/SO_ERROR off the UI queue. Never equate NW waiting,
    // a timeout, or "no response bytes" with a refused/closed listener.
    guard let rawPort = redirect.port, let port = UInt16(exactly: rawPort) else {
      record(false, detail: "invalid-probe-port"); return
    }
    // Retain the prior quarter-second handoff for NWListener.cancel's asynchronous
    // teardown. After that handoff an accepted/open socket is an immediate FAIL.
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.25) {
      let outcome = TCPClosureProbe.connect(port: port)
      DispatchQueue.main.async {
        self.closeProbe = outcome.label
        self.record(pass && outcome == .refused, detail: outcome == .refused ? detail : "listener-not-proven-closed")
      }
    }
  }

  func record(_ pass: Bool, detail: String) {
    guard !completed else { return }
    completed = true
    provider?.cancel()
    providerConnections.forEach { $0.cancel() }
    stage = "completed"
    persist(pass: pass, detail: detail)
    label.text = pass ? "PASS \(mode)" : "FAIL \(mode): \(detail)"
  }

  func persist(pass: Bool? = nil, detail: String = "running") {
    let receipt: [String: Any] = [
      "run_id": runId, "provider_port": (provider?.port).map { Int($0.rawValue) as Any } ?? NSNull(),
      "probe_control_open": probeControlOpen, "probe_control_closed": probeControlClosed,
      "close_probe": closeProbe,
      "mode": mode, "pass": pass.map { $0 as Any } ?? NSNull(), "detail": detail,
      "stage": stage, "started": started, "rejected": rejected, "provider_served": served,
      "callback_triggered": callbackAt != nil,
      "started_at": startedAt.map { $0.timeIntervalSince1970 as Any } ?? NSNull(),
      "provider_at": providerAt.map { $0.timeIntervalSince1970 as Any } ?? NSNull(),
      "callback_at": callbackAt.map { $0.timeIntervalSince1970 as Any } ?? NSNull(),
      "native_elapsed_seconds": nativePreparedAt.map { Date().timeIntervalSince($0) as Any } ?? NSNull()
    ]
    let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("receipt.json")
    try? JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: path, options: .atomic)
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window! }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(ProofDelegate.self))
