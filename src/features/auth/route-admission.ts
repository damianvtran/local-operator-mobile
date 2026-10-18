/**
 * A selected route is provisional until its login/mint finishes. The store's
 * revision is the admission lease: switching, signing out or unmounting revokes
 * it, so a late response cannot publish a client or a refusal for another route.
 * Keep this boundary free of React so request ordering can be exercised against
 * an actual HTTP listener without replacing the app's authentication policy.
 */
import { type CustomRoute, signInToCustomRoute } from "@/connection";
import { RelayError } from "@/relay";
import type { ConnectionStoreApi } from "@/state/connection-store";

export interface RouteAdmission {
	isCurrent: () => boolean;
	publish: (accept: () => void) => boolean;
}

export const routeAdmission = (
	store: ConnectionStoreApi,
	isMounted: () => boolean,
): RouteAdmission => {
	const revision = store.getState().revision;
	const isCurrent = () => isMounted() && store.getState().revision === revision;
	return {
		isCurrent,
		publish(accept) {
			if (!isCurrent()) return false;
			accept();
			store.getState().markLive({ accountLabel: null });
			return true;
		},
	};
};

export const authenticateCustomRoute = async (
	route: CustomRoute,
	password: string,
	admission: RouteAdmission,
	signIn: typeof signInToCustomRoute = signInToCustomRoute,
): Promise<boolean> => {
	if (!admission.isCurrent()) return false;
	const result = await signIn(route, password);
	if (!admission.isCurrent()) return false;
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
