/** Explicit pre-dispatch source/socket gate, NOT native/browser/render proof.
 *
 * Requires a pre-existing pinned core checkout/venv and owned scratch. This is
 * deliberately not an automatic unit test: ordinary phone CI does not have
 * Python/core dependencies and must not silently download another runtime.
 * All positive policy JSON/config side effects come from REAL core C1; only
 * transport faults and the stale-source negative control are synthetic.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { accountRoutingSchema } from "../../src/contracts/schemas.ts";
import {
	assertPolicyFixtureIdentity,
	createCanonicalPolicyFixture,
} from "./account-routing.ts";
import { createRelay } from "./relay.ts";

const coreRoot = process.env.LOH12_CORE_ROOT;
const python = process.env.LOH12_CORE_PYTHON;
const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD;
if (!coreRoot || !python || !scratch)
	throw new Error(
		"supply existing LOH12_CORE_ROOT/LOH12_CORE_PYTHON and owned LOCAL_OPERATOR_SCRATCHPAD",
	);
const runId = randomUUID();
const privateRoot = join(scratch, `native-canonical-policy-${runId}`);
const wireTrace: { method: string; path: string; status: number }[] = [];
const password = "synthetic-policy-fixture-only";
const path = "/api/settings/account-routing";
const PRIVATE_IDENTITY_ERROR = /unique per-run/;
const COOKIE_HTTP_ONLY = /httponly/i;
const COOKIE_PATH = /path=\//i;
const COOKIE_DOMAIN = /domain=/i;
const STALE_BRIDGE_ERROR = /missing or stale canonical bridge source identity/;
const PROFILE_ALIAS_ERROR = /private computer profile escaped fixture storage/;
const CONFIG_ALIAS_ERROR =
	/private config file cannot alias another configuration/;
const cfgDigest = (profile: "a" | "b") => {
	const file = join(privateRoot, profile, "config.yml");
	return existsSync(file)
		? createHash("sha256").update(readFileSync(file)).digest("hex")
		: "missing";
};
type Bound = { port: number; url: string; hostname: string };
type WireReply = {
	status: number;
	body: string;
	headers: import("node:http").IncomingHttpHeaders;
};

/** Actual OS-DNS + socket I/O to the unique advertised hostname. There is no
 * DNS/header-only stand-in or shared-IP URL fallback. Browser and Android/iOS
 * resolution still need their own admitted preflight; Node is not native UI. */
function wire(
	bound: Bound,
	method: string,
	route: string,
	body?: string,
	headers: Record<string, string> = {},
): Promise<WireReply> {
	return new Promise((done, fail) => {
		const req = request(
			{
				hostname: bound.hostname,
				port: bound.port,
				path: route,
				method,
				headers: { host: `${bound.hostname}:${bound.port}`, ...headers },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					wireTrace.push({ method, path: route, status: res.statusCode ?? 0 });
					done({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
						headers: res.headers,
					});
				});
			},
		);
		req.setTimeout(15000, () =>
			req.destroy(new Error("bounded fixture socket timeout")),
		);
		req.on("error", fail);
		if (body !== undefined) req.write(body);
		req.end();
	});
}
const jsonWire = (
	b: Bound,
	method: string,
	cookie: string,
	body?: unknown,
	origin?: string,
) =>
	wire(b, method, path, body === undefined ? undefined : JSON.stringify(body), {
		cookie,
		"content-type": "application/json",
		...(origin ? { origin } : {}),
	});
// Match the existing Node mock verifier: real sockets + the APP schema, not
// a second policy/default enum or a fake positive transport. Native-client /
// editor / OS-jar behavior remains a separate real-flow acceptance surface.
const apiFor = (b: Bound, sessionHeader: string) => {
	const call = async (method: string, body?: unknown) => {
		const response = await jsonWire(b, method, sessionHeader, body, b.url);
		if (response.status !== 200)
			throw new Error(`fixture HTTP ${response.status}`);
		return accountRoutingSchema.parse(JSON.parse(response.body));
	};
	return {
		accountRouting: () => call("GET"),
		setAccountRouting: (value: string) => call("PATCH", { value }),
	};
};
const proof: Record<string, unknown> = {};
const relays: ReturnType<typeof createRelay>[] = [];
try {
	const a = createCanonicalPolicyFixture({
		python,
		coreRoot,
		privateRoot,
		profile: "a",
	});
	const b = createCanonicalPolicyFixture({
		python,
		coreRoot,
		privateRoot,
		profile: "b",
	});
	assert.notEqual(a.hostname, b.hostname);
	assert.notEqual(a.cookieName, b.cookieName);
	assert.throws(
		() => assertPolicyFixtureIdentity("localhost", a.cookieName),
		PRIVATE_IDENTITY_ERROR,
	);
	assert.throws(
		() => assertPolicyFixtureIdentity(a.hostname, "lop_mobile"),
		PRIVATE_IDENTITY_ERROR,
	);
	assert.throws(
		() => assertPolicyFixtureIdentity("127.0.0.1", "lop_mobile"),
		PRIVATE_IDENTITY_ERROR,
	);
	const start = async (fixture: typeof a): Promise<Bound> => {
		const relay = createRelay({ password, accountRouting: fixture });
		relays.push(relay);
		const listener = await relay.listen();
		const bound = { ...listener, hostname: fixture.hostname };
		return bound;
	};
	const aa = await start(a);
	const bb = await start(b);
	/* The Android emulator host allowance, exercised over real sockets.
	 *
	 * WHY IT IS CHECKED HERE: the allowance is a containment change to the fixture,
	 * so the proof that it is SCOPED has to run the same real HTTP path the
	 * strict-host checks above use — a predicate unit test would not show that the
	 * branch is wired through `listen`/`setBoundPort` and the request handler.
	 * Every "must still refuse" case is asserted, not described. */
	const emulatorHost = (bound: Bound) => `10.0.2.2:${bound.port}`;
	const emulatorWire = (
		bound: Bound,
		method: string,
		route: string,
		host: string,
		extra: Record<string, string> = {},
	) => wire(bound, method, route, undefined, { host, ...extra });
	{
		const admitted = createCanonicalPolicyFixture({
			python,
			coreRoot,
			privateRoot,
			profile: "a",
			admitEmulatorHost: true,
		});
		const relay = createRelay({ password, accountRouting: admitted });
		relays.push(relay);
		const listener = await relay.listen();
		const bound = { ...listener, hostname: admitted.hostname };
		// The exact emulator host, no auth: admitted past the host gate, refused by
		// auth — so the allowance opens the HOST boundary only, never the session.
		assert.equal(
			(await emulatorWire(bound, "GET", path, emulatorHost(bound))).status,
			401,
		);
		// Wrong password on the admitted host: still 401, still no cookie.
		const wrong = await emulatorWire(
			bound,
			"POST",
			"/login",
			emulatorHost(bound),
			{
				"content-type": "application/x-www-form-urlencoded",
			},
		);
		assert.equal(wrong.status, 401);
		assert.equal(wrong.headers["set-cookie"], undefined);
		// Every other Host stays refused: a different emulator address, and the
		// SAME address at a different port (the allowance is port-scoped).
		for (const host of [
			`10.0.2.3:${bound.port}`,
			`10.0.2.2:${bound.port + 1}`,
			`127.0.0.1:${bound.port}`,
			"example.invalid",
		])
			assert.equal(
				(await emulatorWire(bound, "GET", path, host)).status,
				403,
				`Host ${host} must stay refused`,
			);
		// The fixture's own hostname still works — the allowance adds a caller, it
		// does not replace the boundary.
		assert.equal((await wire(bound, "GET", path)).status, 401);
		proof.emulatorHostAllowance =
			"admitted 10.0.2.2 at the bound port (401 unauthenticated); refused other address, other port, loopback and a foreign name; own hostname unchanged";
	}
	{
		// Flag ABSENT: the same emulator Host is refused outright, so an ordinary
		// fixture is no more open than it was before this option existed.
		const strict = createCanonicalPolicyFixture({
			python,
			coreRoot,
			privateRoot,
			profile: "b",
		});
		const relay = createRelay({ password, accountRouting: strict });
		relays.push(relay);
		const listener = await relay.listen();
		const bound = { ...listener, hostname: strict.hostname };
		assert.equal(
			(await emulatorWire(bound, "GET", path, emulatorHost(bound))).status,
			403,
		);
		proof.emulatorHostRefusedByDefault =
			"a fixture without admitEmulatorHost refuses the emulator Host (403)";
	}
	const login = async (bound: Bound, fixture: typeof a) => {
		assert.equal((await wire(bound, "GET", path)).status, 401);
		assert.equal(
			(
				await wire(bound, "GET", "/login", undefined, {
					host: `127.0.0.1:${bound.port}`,
				})
			).status,
			403,
		);
		const response = await wire(
			bound,
			"POST",
			"/login",
			new URLSearchParams({ password }).toString(),
			{ "content-type": "application/x-www-form-urlencoded" },
		);
		assert.equal(response.status, 303);
		const cookie = response.headers["set-cookie"]?.[0];
		assert.ok(cookie);
		const [pair = "", ...attrs] = cookie.split(";");
		assert.equal(pair.split("=")[0], fixture.cookieName);
		const attributes = attrs.join(";");
		assert.match(attributes, COOKIE_HTTP_ONLY);
		assert.match(attributes, COOKIE_PATH);
		assert.doesNotMatch(attributes, COOKIE_DOMAIN);
		// Domains are absent from a request Cookie header. Duplicate same-name
		// pairs represent parent-domain/host-only collision in either order;
		// rejecting BOTH avoids relying on whichever cookie the parser sees first.
		const value = pair.slice(pair.indexOf("=") + 1);
		assert.equal(
			(await jsonWire(bound, "GET", `lop_mobile=${value}`)).status,
			401,
		);
		assert.equal(
			(
				await jsonWire(
					bound,
					"GET",
					`${pair}; ${fixture.cookieName}=invalid-domain-cookie`,
				)
			).status,
			401,
		);
		assert.equal(
			(
				await jsonWire(
					bound,
					"GET",
					`${fixture.cookieName}=invalid-domain-cookie; ${pair}`,
				)
			).status,
			401,
		);
		return pair;
	};
	const ca = await login(aa, a);
	const cb = await login(bb, b);
	assert.equal((await jsonWire(aa, "GET", cb)).status, 401);
	const apiA = apiFor(aa, ca);
	const apiB = apiFor(bb, cb);
	const initial = await apiA.accountRouting();
	const initialB = await apiB.accountRouting();
	assert.deepEqual(initial, initialB);
	const before = cfgDigest("a");
	assert.equal(
		(
			await jsonWire(
				aa,
				"PATCH",
				ca,
				{ value: "invalid-policy-control" },
				aa.url,
			)
		).status,
		422,
	);
	assert.equal(
		(
			await jsonWire(
				aa,
				"PATCH",
				ca,
				{ key: "providers.apiKey", value: "invalid-policy-control" },
				aa.url,
			)
		).status,
		422,
	);
	assert.equal(
		(
			await jsonWire(
				aa,
				"PATCH",
				ca,
				{ value: initial.setting.default },
				"https://wrong-origin.example.invalid",
			)
		).status,
		403,
	);
	assert.equal(cfgDigest("a"), before);
	for (const choice of initial.setting.choices) {
		const saved = await apiA.setAccountRouting(choice.value);
		assert.equal(saved.setting.value, choice.value);
		// Every call is a NEW Python process loading the real private config.
		assert.equal((await apiA.accountRouting()).setting.value, choice.value);
	}
	assert.notEqual(cfgDigest("a"), "missing");
	assert.equal(
		(await apiB.accountRouting()).setting.value,
		initialB.setting.value,
	);
	assert.equal(cfgDigest("b"), "missing");
	const next = initial.setting.choices.find(
		(choice) => choice.value !== initial.setting.default,
	);
	assert.ok(next);
	await apiA.setAccountRouting(initial.setting.default);
	a.controls.writeDelayMs = 150;
	const writingA = apiA.setAccountRouting(next.value);
	const bBefore = await apiB.accountRouting();
	await writingA;
	assert.deepEqual(await apiB.accountRouting(), bBefore);
	a.controls.writeDelayMs = 0;
	assert.equal((await apiA.accountRouting()).setting.value, next.value);
	assert.equal(
		(await apiB.accountRouting()).setting.value,
		initialB.setting.value,
	);
	b.controls.readDelayMs = 150;
	let readSettled = false;
	const reloading = apiB.accountRouting().then((value) => {
		readSettled = true;
		return value;
	});
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(readSettled, false);
	await reloading;
	b.controls.readDelayMs = 0;
	b.controls.mode = "forbid-write";
	assert.equal(
		(await jsonWire(bb, "PATCH", cb, { value: next.value }, bb.url)).status,
		403,
	);
	b.controls.mode = "old-relay";
	assert.equal((await jsonWire(bb, "GET", cb)).status, 404);
	b.controls.mode = "malformed";
	await assert.rejects(() => apiB.accountRouting());
	b.controls.mode = "normal";
	b.controls.mode = "drop-after-write";
	await assert.rejects(() => apiB.setAccountRouting(next.value));
	b.controls.mode = "normal";
	assert.equal((await apiB.accountRouting()).setting.value, next.value);
	const logout = await wire(aa, "GET", "/logout", undefined, { cookie: ca });
	assert.equal(logout.status, 303);
	assert.equal(logout.headers["clear-site-data"], undefined);
	assert.ok(logout.headers["set-cookie"]?.[0]?.startsWith(`${a.cookieName}=`));
	// A plausible canned old backend MUST fail source preflight even though its
	// policy body looks valid. This counterfixture never serves positive cases.
	const counter = join(scratch, `native-old-projection-counter-${runId}.sh`);
	assert.ok(!existsSync(counter));
	writeFileSync(
		counter,
		`#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ status: 200, body: initial, source: { core_blob: "stale-source-control" } }).replaceAll("'", "'\\''")}'\n`,
		{ mode: 0o700, flag: "wx" },
	);
	assert.throws(
		() =>
			createCanonicalPolicyFixture({
				python: counter,
				coreRoot,
				privateRoot: join(scratch, `native-stale-policy-counter-${runId}`),
				profile: "a",
			}),
		STALE_BRIDGE_ERROR,
	);
	const guardedRoot = join(scratch, `native-policy-path-guards-${runId}`);
	const guardedA = createCanonicalPolicyFixture({
		python,
		coreRoot,
		privateRoot: guardedRoot,
		profile: "a",
	});
	const guardedB = createCanonicalPolicyFixture({
		python,
		coreRoot,
		privateRoot: guardedRoot,
		profile: "b",
	});
	const unrelated = join(scratch, `native-unrelated-config-${runId}`);
	mkdirSync(unrelated);
	const unrelatedConfig = join(unrelated, "config.yml");
	const unrelatedBytes = JSON.stringify({
		retry: { accountSelectionPolicy: initial.setting.default },
	});
	writeFileSync(unrelatedConfig, unrelatedBytes, { flag: "wx" });
	symlinkSync(unrelated, join(guardedRoot, "a"), "dir");
	await assert.rejects(
		() => guardedA.respond("PATCH", { value: next.value }),
		PROFILE_ALIAS_ERROR,
	);
	mkdirSync(join(guardedRoot, "b"));
	symlinkSync(unrelatedConfig, join(guardedRoot, "b", "config.yml"));
	await assert.rejects(
		() => guardedB.respond("PATCH", { value: next.value }),
		CONFIG_ALIAS_ERROR,
	);
	assert.equal(readFileSync(unrelatedConfig, "utf8"), unrelatedBytes);
	// Direct neighbor: opting OUT retains the old mock protocol. This is socket
	// only; never use its production-name cookie in a shared browser profile.
	const legacy = createRelay({ password });
	relays.push(legacy);
	const legacyListener = await legacy.listen();
	const legacyBound = { ...legacyListener, hostname: "127.0.0.1" };
	const legacyLogin = await wire(
		legacyBound,
		"POST",
		"/login",
		new URLSearchParams({ password }).toString(),
		{ "content-type": "application/x-www-form-urlencoded" },
	);
	assert.equal(legacyLogin.status, 303);
	const legacyCookie = legacyLogin.headers["set-cookie"]?.[0]?.split(";")[0];
	assert.ok(legacyCookie);
	assert.ok(legacyCookie.startsWith("lop_mobile="));
	assert.equal((await jsonWire(legacyBound, "GET", legacyCookie)).status, 404);
	const legacyLogout = await wire(
		legacyBound,
		"GET",
		"/logout",
		undefined,
		Object.fromEntries([["cookie", legacyCookie]]),
	);
	assert.equal(legacyLogout.headers["clear-site-data"], '"storage"');
	proof.defaultMockCompatibility =
		"PASS opt-out keeps old cookie/404/storage contract; Node sockets only";
	proof.pathGuards =
		"PASS profile/config symlink aliases refused; unrelated owned config bytes unchanged";
	proof.runId = runId;
	proof.wireTrace = wireTrace;
	proof.identity = [
		{ ...a.identity, advertisedOrigin: aa.url },
		{ ...b.identity, advertisedOrigin: bb.url },
	];
	proof.trace = [a.trace, b.trace];
	proof.matrix =
		"PASS source-only actual canonical HTTP/config, auth401/403/422, cookie/host scope, all backend choices, new-process readback, A/B isolation, pending A-write/B-read isolation, delayed reads, old404, malformed, uncertain committed write, stale-source rejection";
	proof.notProven =
		"Native client/editor/OS jar, browser/Android/iOS hostname resolution, compiled app/JS identity, real native policy flows, rendered frames/geometry; no SDK/browser dispatch";
	writeFileSync(
		join(scratch, `native-canonical-http-proof-${runId}.json`),
		JSON.stringify(proof, null, 2),
	);
	console.log(JSON.stringify(proof, null, 2));
} finally {
	for (const relay of relays.reverse()) await relay.shutdown();
}
