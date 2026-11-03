import Darwin
import Foundation

/// Evidence-only TCP probe. NWConnection can stay .waiting while offering no
/// terminal refusal event. Use the socket's actual connect/SO_ERROR result;
/// only ECONNREFUSED proves this literal-loopback endpoint has no listener.
/// A reachable (even non-accepting) listener MUST return .open and fail closure.
enum TCPClosureProbe {
  enum Outcome: Equatable {
    case open, refused, timedOut, failed(Int32)
    var label: String {
      switch self {
      case .open: return "open"
      case .refused: return "refused"
      case .timedOut: return "timeout"
      case .failed(let code): return "error_\(code)"
      }
    }
  }

  static func connect(port: UInt16, timeoutMs: Int32 = 1500) -> Outcome {
    let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return .failed(errno) }
    defer { Darwin.close(fd) }
    guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { return .failed(errno) }
    var address = loopback(port)
    let result = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    if result == 0 { return .open }
    if errno == ECONNREFUSED { return .refused }
    guard errno == EINPROGRESS else { return .failed(errno) }
    let deadline = ProcessInfo.processInfo.systemUptime + Double(timeoutMs) / 1000
    while true {
      let remaining = deadline - ProcessInfo.processInfo.systemUptime
      if remaining <= 0 { return .timedOut }
      var descriptor = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
      let ready = Darwin.poll(&descriptor, 1, max(1, Int32(remaining * 1000)))
      if ready == 0 { return .timedOut }
      if ready < 0 {
        if errno == EINTR { continue }
        return .failed(errno)
      }
      var error: Int32 = 0
      var length = socklen_t(MemoryLayout<Int32>.size)
      guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) == 0 else { return .failed(errno) }
      if error == 0 { return .open }
      return error == ECONNREFUSED ? .refused : .failed(error)
    }
  }

  /// Discriminating control: leave an actual listener open without accepting.
  /// A probe that mistakes waiting/no bytes for closure would incorrectly pass
  /// this control. Then close that SAME listener and require actual refusal.
  static func negativeControl() -> (open: Outcome, closed: Outcome) {
    let listener = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard listener >= 0 else { return (.failed(errno), .failed(errno)) }
    var address = loopback(0)
    let bound = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bound == 0, Darwin.listen(listener, 1) == 0 else {
      let error = errno; Darwin.close(listener); return (.failed(error), .failed(error))
    }
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(listener, $0, &length) }
    }
    guard named == 0 else {
      let error = errno; Darwin.close(listener); return (.failed(error), .failed(error))
    }
    let port = UInt16(bigEndian: address.sin_port)
    let open = connect(port: port)
    Darwin.close(listener)
    return (open, connect(port: port))
  }

  private static func loopback(_ port: UInt16) -> sockaddr_in {
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    return address
  }
}
