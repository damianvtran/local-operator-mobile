import Foundation

/// Foundation-only use of the unmodified production client. The sentinel can
/// only follow a valid ready reply AND a refused next request; no UI is linked.
@main struct LaunchOnlyProtocolFixture {
  static func main() async {
    do {
      let client = try ReplayHostClient(environment: ProcessInfo.processInfo.environment)
      _ = try await client.request("runner-ready")
      do {
        _ = try await client.request("before-observe")
        print("unexpected-observation-grant")
      } catch {
        print("ready-accepted-observation-refused")
      }
    } catch {
      print("ready-refused")
    }
  }
}
