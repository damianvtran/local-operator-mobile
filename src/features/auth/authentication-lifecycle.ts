/**
 * Publication guards cannot undo platform cookies or keystore writes. Serialize
 * authentication side effects in their actual ownership domain: one queue per
 * browser origin, and one native credential-store retirement barrier. These
 * owners outlive a provider mount, so a remount cannot outrun its predecessor's
 * compensating logout or durable clear. No polling/retry is introduced.
 */
import {
	type CustomRoute,
	signInToCustomRoute,
	signOutOfCustomRoute,
	type TunnelSessionManager,
} from "@/connection";
import { RelayError } from "@/relay";

export class CustomRouteAuthentication {
	private readonly tails = new Map<string, Promise<unknown>>();

	constructor(
		private readonly transport = {
			signIn: signInToCustomRoute,
			signOut: signOutOfCustomRoute,
		},
	) {}

	private run<T>(route: CustomRoute, operation: () => Promise<T>): Promise<T> {
		// Cookies are origin-scoped, not route-revision-scoped. A later login to
		// this same origin must follow the stale login's compensating logout.
		const key = new URL(route.baseUrl).origin;
		const previous = this.tails.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation);
		this.tails.set(key, next);
		void next.then(
			() => {
				if (this.tails.get(key) === next) this.tails.delete(key);
			},
			() => {
				// Retain failed cleanup as a fail-closed restoration barrier. Only an
				// explicit new login/logout can replace it; a remount must not silently
				// reuse the cookie whose retirement could not be confirmed.
			},
		);
		return next;
	}

	signIn(route: CustomRoute, password: string, isCurrent: () => boolean) {
		return this.run(route, async () => {
			if (!isCurrent()) return null;
			const result = await this.transport.signIn(route, password);
			if (isCurrent()) return result;
			// Even a failed/opaque login may have changed the platform jar. Finish
			// retirement inside this slot before admitting any newer same-origin work.
			const retired = await this.transport.signOut(route);
			if (!retired.signedOut)
				throw new RelayError(
					"transport",
					"The cancelled login could not be signed out",
				);
			return null;
		});
	}

	signOut(route: CustomRoute) {
		return this.run(route, async () => {
			const result = await this.transport.signOut(route);
			// The canonical boundary returns a verdict even on network/503 failure.
			// Fulfillment is not proof of logout: clearing this tail would allow a
			// remount to restore the very cookie whose retirement just failed.
			if (!result.signedOut)
				throw new RelayError("transport", "Sign-out could not be confirmed");
			return result;
		});
	}

	/** Admission reads must not overtake another mount's pending cookie cleanup. */
	settled(route: CustomRoute): Promise<unknown> {
		return this.tails.get(new URL(route.baseUrl).origin) ?? Promise.resolve();
	}
}

export class NativeCredentialRetirement {
	private tail: Promise<void> = Promise.resolve();

	retire(
		manager: TunnelSessionManager | null,
		clear?: () => Promise<void>,
		revokeCurrent = true,
	): Promise<void> {
		// Retiring is synchronous even when another clear is queued: no later
		// token response may start a write while the barrier is being assembled.
		const retired = manager?.retire(revokeCurrent) ?? Promise.resolve();
		const next = Promise.all([this.tail, retired]).then(async () => {
			await clear?.();
		});
		this.tail = next;
		return next;
	}

	settled(): Promise<void> {
		return this.tail;
	}
}

export const customRouteAuthentication = new CustomRouteAuthentication();
export const nativeCredentialRetirement = new NativeCredentialRetirement();
