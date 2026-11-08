import AuthenticationServices
import Foundation
import Network
import UIKit

/// HTTP loopback is registered with Radient, but is NOT an ASWebAuthenticationSession
/// callback scheme. Bind first, then run the system browser and explicitly finish it
/// when the HTTP request arrives. This core is also compiled into the hosted proof app.
final class LoopbackAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
  private let queue = DispatchQueue.main
  private var listener: NWListener?
  private var browser: ASWebAuthenticationSession?
  private var connections: [UUID: NWConnection] = [:]
  private var deadline: DispatchWorkItem?
  private var prepared: ((Result<URL, Error>) -> Void)?
  private var completion: ((Result<URL?, Error>) -> Void)?
  private var redirect: URL?
  private var expectedState: String?
  private var accepted = false
  private var ended = false
  // Receipts count rejection without recording codes, state, or request URLs.
  var onRejectedRequest: (() -> Void)?
  var timeoutSeconds: TimeInterval = 300

  private enum Failure: Error { case invalid, unavailable, timeout }

  func prepare(_ done: @escaping (Result<URL, Error>) -> Void) {
    guard listener == nil, !ended else { done(.failure(Failure.invalid)); return }
    prepared = done
    do {
      let parameters = NWParameters.tcp
      // An explicit local endpoint is essential: NWListener defaults to all interfaces.
      parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
      let server = try NWListener(using: parameters)
      listener = server
      server.stateUpdateHandler = { [weak self] state in
        guard let self, !self.ended else { return }
        switch state {
        case .ready:
          guard let port = self.listener?.port,
                let url = URL(string: "http://127.0.0.1:\(port.rawValue)/callback") else {
            self.finish(.failure(Failure.unavailable)); return
          }
          self.redirect = url
          let callback = self.prepared
          self.prepared = nil
          callback?(.success(url))
        case .failed: self.finish(.failure(Failure.unavailable))
        default: break
        }
      }
      server.newConnectionHandler = { [weak self] connection in
        guard let self, !self.ended, self.connections.count < 8 else {
          connection.cancel(); return
        }
        let id = UUID()
        self.connections[id] = connection
        connection.start(queue: self.queue)
        self.queue.asyncAfter(deadline: .now() + 5) { [weak self, weak connection] in
          connection?.cancel()
          self?.connections.removeValue(forKey: id)
        }
        self.receive(connection, id: id, bytes: Data())
      }
      let timer = DispatchWorkItem { [weak self] in self?.finish(.failure(Failure.timeout)) }
      deadline = timer
      queue.asyncAfter(deadline: .now() + timeoutSeconds, execute: timer)
      server.start(queue: queue)
    } catch { finish(.failure(error)) }
  }

  func open(url: URL, redirect: URL, done: @escaping (Result<URL?, Error>) -> Void) {
    guard !ended, completion == nil, self.redirect == redirect,
          let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          query.filter({ $0.name == "redirect_uri" }).map({ $0.value }) == [redirect.absoluteString],
          let state = query.first(where: { $0.name == "state" })?.value, !state.isEmpty else {
      done(.failure(Failure.invalid)); cancel(); return
    }
    expectedState = state
    completion = done
    // No fake HTTP callback scheme: only the listener can complete this flow.
    let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { [weak self] _, error in
      DispatchQueue.main.async {
        guard let self, !self.ended else { return }
        if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
          self.finish(.success(nil))
        } else {
          self.finish(.failure(Failure.unavailable))
        }
      }
    }
    browser = session
    session.presentationContextProvider = self
    guard session.start() else { finish(.failure(Failure.unavailable)); return }
  }

  func cancel() { finish(.success(nil)) }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }

  private func receive(_ connection: NWConnection, id: UUID, bytes: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 4096 - bytes.count) { [weak self] chunk, _, complete, error in
      guard let self, !self.ended else { connection.cancel(); return }
      var data = bytes
      if let chunk { data.append(chunk) }
      if let text = String(data: data, encoding: .utf8), text.contains("\r\n\r\n") {
        self.handle(text, connection: connection, id: id)
      } else if data.count >= 4096 || complete || error != nil {
        self.reply(connection, id: id, status: "400 Bad Request", callback: nil)
      } else { self.receive(connection, id: id, bytes: data) }
    }
  }

  private func handle(_ request: String, connection: NWConnection, id: UUID) {
    let lines = request.components(separatedBy: "\r\n")
    let first = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: false)
    let hosts = lines.dropFirst().filter { $0.lowercased().hasPrefix("host:") }
      .map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces) }
    guard !accepted, let redirect, let port = redirect.port, let state = expectedState,
          first.count == 3, first[0] == "GET", first[2] == "HTTP/1.1",
          hosts == ["127.0.0.1:\(port)"], first[1].hasPrefix("/callback?"),
          let url = URL(string: "http://127.0.0.1:\(port)\(first[1])"),
          let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
          parts.scheme == "http", parts.host == "127.0.0.1", parts.port == port,
          parts.path == "/callback", parts.fragment == nil, parts.user == nil, parts.password == nil,
          let query = parts.queryItems,
          query.filter({ $0.name == "state" }).map({ $0.value }) == [state],
          (query.filter({ $0.name == "code" }).count == 1 && !(query.first(where: { $0.name == "code" })?.value ?? "").isEmpty)
            || (query.filter({ $0.name == "error" }).count == 1 && !(query.first(where: { $0.name == "error" })?.value ?? "").isEmpty) else {
      onRejectedRequest?()
      reply(connection, id: id, status: "400 Bad Request", callback: nil)
      return
    }
    accepted = true
    reply(connection, id: id, status: "200 OK", callback: url)
  }

  private func reply(_ connection: NWConnection, id: UUID, status: String, callback: URL?) {
    // Never reflect the callback query into a browser page or a diagnostic.
    let body = status == "200 OK" ? "Sign-in received. You can return to the app." : "Invalid sign-in callback."
    let response = "HTTP/1.1 \(status)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n\(body)"
    connection.send(content: Data(response.utf8), completion: .contentProcessed { [weak self] _ in
      connection.cancel()
      self?.connections.removeValue(forKey: id)
      if let callback { self?.finish(.success(callback)) }
    })
  }

  private func finish(_ result: Result<URL?, Error>) {
    guard !ended else { return }
    ended = true
    deadline?.cancel(); deadline = nil
    listener?.cancel(); listener = nil
    connections.values.forEach { $0.cancel() }; connections.removeAll()
    let pending = prepared; prepared = nil
    let done = completion; completion = nil
    let session = browser; browser = nil
    session?.cancel()
    pending?(.failure(Failure.unavailable))
    done?(result)
  }
}
