/**
 * Where the session screen's relay client comes from.
 *
 * **The configured route always wins.** The one source of a route is the
 * connection store, and this module reads it and nothing else for the primary
 * path: a session screen that could point its own requests somewhere the route
 * did not choose would be a second answer to "which computer am I talking to",
 * and on a route that carries credentials that is not a UI question.
 *
 * **The web build's one exception, and why it is not a test hack.** The shipped
 * web client is served BY the relay (`~/local-operator/local_operator/mobile/web`
 * is a route inside the daemon's own server), so it talks to its own origin: there
 * is no discovery step and no route to configure, because being served by the
 * relay *is* the route. The native app has no such property — it is installed, so
 * it must discover — but the web export does, and reproducing the web client's
 * behaviour is the point of that export. So on `Platform.OS === "web"` with no
 * route configured, the page's own origin is the relay base.
 *
 * Three properties keep that from becoming a hole:
 *
 *   1. It is gated on the WEB build. Native never evaluates the branch, so an
 *      installed app cannot be pointed at a host by anything in a URL.
 *   2. It only applies when the connection store has NO route. A configured route
 *      is checked first and returned immediately, so the origin can never
 *      override one — the store is the authority and this is a default for the
 *      case where the store has nothing to say.
 *   3. It reads the origin, never a query parameter or stored value. Nothing in a
 *      URL can choose where this app sends a request, so there is no
 *      credential-steering surface to reason about: the worst case is a web page
 *      talking to the host that served it, which is what a web page does.
 *
 * This is also what lets the capture harness drive the app at all: the mock
 * relay's scenarios are the states worth capturing, and a same-origin relay is
 * the one way to reach them without seeding configuration into the page.
 */

import { Platform } from "react-native";
import type { RouteProfile } from "@/connection";
import {
	type CustomRoute,
	createRelayClient,
	isPrivateHost,
} from "@/connection";
import type { RelayEndpoints } from "@/relay";

/** A custom route whose base URL is the current page's origin. Built here rather
 *  than through `profile.ts`'s validator because there is nothing to validate:
 *  the value comes from the browser's own location, not from user input.
 *
 *  `allowInsecure` is derived rather than assumed. A page served over `http://`
 *  can only be a loopback/private development surface (a browser refuses
 *  `http://` for a public host for anything that needs a cookie), and the flag
 *  exists to say "the cleartext warning was acknowledged". Deriving it from the
 *  host means the flag cannot be true for a public origin, so the one thing the
 *  flag protects is never waived by this shortcut. */
const originRoute = (origin: string): CustomRoute => ({
	mode: "custom",
	baseUrl: origin,
	allowInsecure:
		origin.startsWith("http://") && isPrivateHost(new URL(origin).hostname),
});

/** The four answers this module can give. `null` endpoints plus a `reason` is the
 *  honest "there is nothing to talk to", which the screen renders rather than
 *  faking a state. */
export interface SessionRelaySource {
	endpoints: RelayEndpoints | null;
	/** The route's base URL, for a diagnostic line and the tests. */
	baseUrl: string | null;
	/** True when the relay came from the page origin rather than the store. */
	fromOrigin: boolean;
	reason: "ok" | "no-route";
}

const NO_ROUTE: SessionRelaySource = {
	endpoints: null,
	baseUrl: null,
	fromOrigin: false,
	reason: "no-route",
};

/**
 * The relay client for a session screen.
 *
 * `route` is passed in rather than read from the store here, so this stays a pure
 * function of its inputs and the store subscription lives in the hook
 * (`use-session-stream.ts`) where a re-render can follow it.
 */
export const relaySource = (
	route: RouteProfile | null,
	origin: string | null,
): SessionRelaySource => {
	/* The store's route first, and returned immediately: condition 2 in the file
	 * header. Nothing below can be reached while a route exists. */
	if (route !== null) {
		return {
			endpoints: createRelayClient({ route }),
			baseUrl:
				route.mode === "radient" ? `https://${route.hostname}` : route.baseUrl,
			fromOrigin: false,
			reason: "ok",
		};
	}
	if (Platform.OS !== "web") return NO_ROUTE;
	if (origin === null || origin.length === 0) return NO_ROUTE;
	const pageRoute = originRoute(origin);
	return {
		endpoints: createRelayClient({ route: pageRoute }),
		baseUrl: pageRoute.baseUrl,
		fromOrigin: true,
		reason: "ok",
	};
};

/** The page's own origin, or `null` when there is not one (native, a
 *  `file://` document, or a JS runtime with no `location`). */
export const pageOrigin = (): string | null => {
	if (Platform.OS !== "web") return null;
	const location = globalThis.location;
	if (!location || typeof location.origin !== "string") return null;
	if (location.protocol !== "http:" && location.protocol !== "https:")
		return null;
	return location.origin;
};
