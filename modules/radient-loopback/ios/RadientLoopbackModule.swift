import ExpoModulesCore

public final class RadientLoopbackModule: Module {
  private var flow: LoopbackAuthSession?

  public func definition() -> ModuleDefinition {
    Name("RadientLoopback")
    AsyncFunction("prepare") { (promise: Promise) in
      guard self.flow == nil else {
        promise.reject("ERR_AUTH_BUSY", "Sign-in is already running")
        return
      }
      let flow = LoopbackAuthSession()
      self.flow = flow
      flow.prepare { result in
        switch result {
        case .success(let redirect): promise.resolve(redirect.absoluteString)
        case .failure: self.flow = nil; promise.reject("ERR_AUTH_BIND", "Could not bind the sign-in callback")
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("open") { (url: URL, redirect: URL, promise: Promise) in
      guard let flow = self.flow else {
        promise.reject("ERR_AUTH_NOT_READY", "The sign-in callback is not ready")
        return
      }
      flow.open(url: url, redirect: redirect) { result in
        self.flow = nil
        switch result {
        case .success(let callback): promise.resolve(callback?.absoluteString)
        case .failure: promise.reject("ERR_AUTH_CALLBACK", "Sign-in callback failed or timed out")
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("dismiss") {
      self.flow?.cancel()
      self.flow = nil
    }.runOnQueue(.main)
    OnDestroy {
      DispatchQueue.main.async {
        self.flow?.cancel()
        self.flow = nil
      }
    }
  }
}
