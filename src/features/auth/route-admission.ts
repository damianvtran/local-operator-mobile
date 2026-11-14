/**
 * A selected route is provisional until its login/mint finishes. The store's
 * revision is the admission lease: switching, signing out or unmounting revokes
 * it, so a late response cannot publish a client or a refusal for another route.
 * Keep this boundary free of React so request ordering can be exercised against
 * an actual HTTP listener without replacing the app's authentication policy.
 */
import type { CustomRoute } from "@/connection";
import { RelayError } from "@/relay";
import type { ConnectionStoreApi } from "@/state/connection-store";
import {
	type CustomRouteAuthentication,
	customRouteAuthentication,
} from "./authentication-lifecycle";

export interface RouteAdmission {
	isCurrent: () => boolean;
	publish: (accept: () => void) => boolean;
}

/**
 * `accountLabel` is read at PUBLISH time, not when the route starts: a Radient
 * route is often begun before its sign-in or refresh lands, and the label rides
 * on the grant that admission proves. It is the identity Settings shows as the
 * account title, so a Radient route that admitted with `null` told a signed-in
 * user "Not signed in with Radient" (PR #261 design round 2). A custom route has
 * no Radient identity, so the default stays `null`.
 */
export const routeAdmission = (
	store: ConnectionStoreApi,
	isMounted: () => boolean,
	accountLabel: () => string | null = () => null,
): RouteAdmission => {
	const revision = store.getState().revision;
	const isCurrent = () => isMounted() && store.getState().revision === revision;
	return {
		isCurrent,
		publish(accept) {
			if (!isCurrent()) return false;
			accept();
			store.getState().markLive({ accountLabel: accountLabel() });
			return true;
		},
	};
};

export const authenticateCustomRoute = async (
	route: CustomRoute,
	password: string,
	admission: RouteAdmission,
	authentication: CustomRouteAuthentication = customRouteAuthentication,
): Promise<boolean> => {
	if (!admission.isCurrent()) return false;
	const result = await authentication.signIn(
		route,
		password,
		admission.isCurrent,
	);
	if (!result || !admission.isCurrent()) return false;
	if (result.signedIn) return true;
	// The canonical login boundary already verifies opaque redirects. Re-reading
	// after a definite wrong password would be an unauthorized request, not proof.
	throw (
		result.failure ??
		new RelayError("relay-unauthorized", "Authentication required", {
			surface: "password",
			detail: "",
		})
	);
};
