/**
 * Session consumers use the provider's admitted client, never a client built from
 * a selected address. A same-origin web page is not proof of authentication:
 * deep links mount before cold-start login finishes. The provider owns that
 * admission too, so sign-out cannot fall back to the page origin and reconnect.
 */
import type { RouteProfile } from "@/connection";
import type { RelayEndpoints } from "@/relay";

export interface SessionRelaySource {
	endpoints: RelayEndpoints | null;
	baseUrl: string | null;
	fromOrigin: boolean;
	reason: "ok" | "no-route" | "pending";
}

export const relaySource = (
	route: RouteProfile | null,
	client: RelayEndpoints | null,
	pending: boolean,
): SessionRelaySource => ({
	endpoints: route === null ? null : client,
	baseUrl:
		route === null
			? null
			: route.mode === "radient"
				? `https://${route.hostname}`
				: route.baseUrl,
	fromOrigin: false,
	reason:
		route !== null && client !== null ? "ok" : pending ? "pending" : "no-route",
});
