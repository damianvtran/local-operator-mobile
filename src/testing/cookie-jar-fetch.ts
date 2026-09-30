/**
 * A `fetch` with a cookie jar, standing in for the platform.
 *
 * On a device the custom route's `lop_mobile` cookie lives in the OS jar
 * (`credentials: 'include'`, ADR 0002 §4) and the app never reads it. Node's
 * `fetch` has no jar at all, so anything that drives the real client over a real
 * socket needs this stand-in to play the part the OS plays. It is deliberately the
 * ONLY place a `Set-Cookie` is read on the custom route, and it lives under
 * `testing/` for that reason: no product module may grow a dependency on it.
 *
 * It honours what a jar must: a cookie is replayed on the next request to the same
 * origin, `Max-Age=0` / an empty value deletes it, and a request without `credentials: 'include'` bypasses the jar entirely (the
 * tunnel route sets its own `Cookie` header).
 */

import { resolveFetch } from "../relay/platform-fetch";

export interface CookieJarFetch {
	fetch: typeof globalThis.fetch;
	/** Cookie names currently held, for assertions. Never the values. */
	names(): string[];
	clear(): void;
}

function setCookiesOf(headers: Headers): string[] {
	const getter = headers as Headers & { getSetCookie?: () => string[] };
	return typeof getter.getSetCookie === "function" ? getter.getSetCookie() : [];
}

export function createCookieJarFetch(
	underlying: typeof globalThis.fetch = resolveFetch(),
): CookieJarFetch {
	const jar = new Map<string, string>();

	const jarFetch: typeof globalThis.fetch = async (input, init) => {
		const useJar = init?.credentials === "include";
		const headers = new Headers(init?.headers);
		if (useJar && jar.size > 0 && !headers.has("cookie")) {
			headers.set(
				"cookie",
				[...jar].map(([name, value]) => `${name}=${value}`).join("; "),
			);
		}
		const response = await underlying(input, { ...init, headers });
		if (useJar) {
			for (const line of setCookiesOf(response.headers)) {
				const [pair = "", ...attributes] = line.split(";");
				const separator = pair.indexOf("=");
				if (separator === -1) continue;
				const name = pair.slice(0, separator).trim();
				const value = pair.slice(separator + 1).trim();
				const expired = attributes.some(
					(attribute) => attribute.trim().toLowerCase() === "max-age=0",
				);
				if (expired || value === "" || value === '""') jar.delete(name);
				else jar.set(name, value);
			}
		}
		return response;
	};

	return {
		fetch: jarFetch,
		names: () => [...jar.keys()],
		clear: () => jar.clear(),
	};
}
