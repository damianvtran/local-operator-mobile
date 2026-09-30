/**
 * A platform boundary that behaves like a BROWSER for `redirect: 'manual'`.
 *
 * Chrome answers a `redirect: 'manual'` request with an opaque redirect: `type`
 * `opaqueredirect`, `status` 0, no headers, no body — the target counts as
 * cross-origin under the CORS model, so its status and URL are unreadable by
 * design. Node's undici and `expo/fetch` return the real `303` instead, so no
 * Node-side test can produce that shape on its own, and the app's successful
 * custom-route sign-in was reported as a failure only in a browser (QA round 3,
 * Q1: `ERR kind=rejected status=0` while the cookie had in fact been set).
 *
 * The wrapper hides the redirect for the paths a caller names and passes
 * everything else through to the REAL fetch, so the follow-up read the client
 * performs to verify admission is a real request to a real relay — the part of
 * the mechanism worth testing.
 */

/** The shape the platform hands back, built as a value because `Response` refuses
 *  a status of 0 (`new Response(null, { status: 0 })` throws a `RangeError`) and
 *  an opaque response cannot be constructed at all. Only the fields a caller can
 *  legitimately read are modelled; the rest exist so a wrong read fails loudly
 *  instead of silently seeing `undefined`. */
function opaqueRedirect(): Response {
	return {
		type: "opaqueredirect",
		status: 0,
		ok: false,
		statusText: "",
		headers: new Headers(),
		body: null,
		bodyUsed: false,
		redirected: false,
		url: "",
		text: async () => "",
		json: async () => {
			throw new SyntaxError("Unexpected end of JSON input");
		},
		arrayBuffer: async () => new ArrayBuffer(0),
		blob: async () => new Blob([]),
		clone: () => opaqueRedirect(),
	} as unknown as Response;
}

export interface OpaqueRedirectOptions {
	/** Which redirected responses to hide. Default: every one, which is what a
	 *  browser does. Narrowing it lets a test hide one route's redirect while
	 *  another route's is still visible. */
	opaque?: (url: URL) => boolean;
}

export function browserRedirectFetch(
	inner: typeof globalThis.fetch,
	options: OpaqueRedirectOptions = {},
): typeof globalThis.fetch {
	const opaque = options.opaque ?? (() => true);
	return async (input, init) => {
		const response = await inner(input, init);
		const isRedirect = response.status >= 300 && response.status < 400;
		if (!isRedirect) return response;
		/* Read the URL the INNER fetch was given: the wrapper's own caller may hand
		 * over a Request, and a test that narrowed `opaque` to one path must not be
		 * defeated by that. */
		const url = new URL(
			typeof input === "string" || input instanceof URL
				? String(input)
				: input.url,
		);
		return opaque(url) ? opaqueRedirect() : response;
	};
}
