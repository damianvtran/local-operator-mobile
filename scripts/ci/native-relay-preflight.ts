/**
 * Cheap transport prerequisite shared by native proof drivers, before booting a
 * simulator. A public health/401 probe does not establish that the authenticated
 * list and SSE seed used AFTER Save and connect are usable (Q163-2).
 *
 * This is HOST evidence, not native evidence: it can discriminate a broken
 * fixture/auth/seed from a device-only failure, but cannot prove ATS, the native
 * cookie jar, or its streaming fetch. Never return/log the temporary cookie.
 */
export async function probeNativeRelay(
	origin: string,
	password: string,
	sessionId?: string,
): Promise<{ authenticatedLists: number; streamSeed: boolean }> {
	const request = (path: string, init: RequestInit = {}) =>
		fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
	const refused = await request("/api/sessions?include_peers=true");
	await refused.arrayBuffer();
	if (refused.status !== 401)
		throw new Error("relay preflight: unauthenticated list must be 401");
	const login = await request("/login", {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded", origin },
		body: new URLSearchParams({ password }),
	});
	await login.arrayBuffer();
	const cookie = login.headers.get("set-cookie")?.split(";")[0];
	if (login.status !== 303 || !cookie)
		throw new Error("relay preflight: login did not admit a session");
	const headers = { cookie, origin };
	// Own-tunnel's admission and the provider's subsequent peer-inclusive cold
	// read must agree; a successful first read alone does not prove the handoff.
	for (const path of ["/api/sessions", "/api/sessions?include_peers=true"]) {
		const response = await request(path, { headers });
		const body = (await response.json()) as {
			sessions?: { session_id?: string }[];
		};
		if (response.status !== 200 || !Array.isArray(body.sessions))
			throw new Error("relay preflight: authenticated list unavailable");
		if (sessionId && !body.sessions.some((row) => row.session_id === sessionId))
			throw new Error(
				"relay preflight: expected session absent from authenticated list",
			);
	}
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), 5000);
	try {
		const response = await fetch(
			`${origin}/api/sessions/events?include_peers=true`,
			{
				headers,
				signal: abort.signal,
			},
		);
		if (response.status !== 200 || !response.body)
			throw new Error("relay preflight: authenticated stream unavailable");
		const reader = response.body.getReader();
		try {
			let seed = "";
			const decoder = new TextDecoder();
			while (!seed.includes("\n\n") && seed.length < 1024 * 1024) {
				const { done, value } = await reader.read();
				if (done) break;
				seed += decoder.decode(value, { stream: true });
			}
			if (
				!seed.includes("event: sessions") ||
				(sessionId && !seed.includes(sessionId))
			)
				throw new Error(
					"relay preflight: session stream did not seed the expected list",
				);
		} finally {
			abort.abort();
			await reader.cancel().catch(() => undefined);
		}
	} finally {
		clearTimeout(timer);
		abort.abort();
	}
	return { authenticatedLists: 2, streamSeed: true };
}

/** Maestro's failed admission or saved-route row assertion is a setup failure,
 * not evidence about a composer/theme. Do not classify later content assertions
 * (e.g. composer-input) as connection failures. */
const CONNECTION_FAILURE =
	/Assertion[^\n]*session-row-|No visible element found: "Connected"/;
export const nativeConnectionPrerequisiteFailed = (log: string): boolean =>
	CONNECTION_FAILURE.test(log);
