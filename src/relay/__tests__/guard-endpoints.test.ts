import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	APPROVAL,
	card,
	DIGEST_A,
	DIGEST_B,
	nonTeamStatus,
	status,
	TENANT,
} from "../../features/guard/guard-fixtures";
import { RelayEndpoints, RelayHttpClient } from "../index";

/**
 * Radient Guard's relay twin, on the wire.
 *
 * The routes below do not exist on a host yet (they are the proposal in
 * `docs/guard.md`, for the host slice that adds the relay twin of L2c's
 * `/v1/desktop/guard`), so these tests pin what THIS client sends and accepts,
 * against synthetic bodies. What they prove is the part that is ours: the
 * method, path and body of every call, that the answer carries the two digests
 * and nothing else, and that the phone has no path to Radient's own API.
 */
const BASE = "https://synthetic-computer.example.invalid";

function transport(response: () => Response) {
	const requests: { url: string; init: RequestInit | undefined }[] = [];
	const http = new RelayHttpClient({
		baseUrl: BASE,
		auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
		fetchImpl: async (url, init) => {
			requests.push({ url: String(url), init });
			return response();
		},
	});
	return { api: new RelayEndpoints(http), requests };
}

describe("every Guard call goes to the relay's /api/guard twin", () => {
	it("reads", async () => {
		const { api, requests } = transport(() => Response.json(status()));
		await api.guardStatus();
		expect(requests.map((r) => [r.init?.method, r.url])).toEqual([
			["GET", `${BASE}/api/guard`],
		]);
		expect(requests[0]?.init?.body).toBeUndefined();
	});

	it("the non-Team card read", async () => {
		const { api, requests } = transport(() =>
			Response.json({
				trial_days: 14,
				org: null,
				url: "https://console.radienthq.com/dashboard/team",
				role: "owner",
			}),
		);
		expect((await api.guardNonTeamCard()).role).toBe("owner");
		expect(requests[0]?.url).toBe(`${BASE}/api/guard/non-team-card`);
	});

	it("revoke and share-again are bodiless POSTs on the org", async () => {
		const { api, requests } = transport(() =>
			Response.json({ tenant: TENANT, status: "revoked", code: "", org: null }),
		);
		await api.guardRevoke(TENANT);
		await api.guardShareAgain(TENANT);
		expect(requests.map((r) => [r.init?.method, r.url])).toEqual([
			["POST", `${BASE}/api/guard/orgs/${TENANT}/revoke`],
			["POST", `${BASE}/api/guard/orgs/${TENANT}/share-again`],
		]);
		for (const r of requests) expect(r.init?.body).toBeUndefined();
	});

	it("a tenant id is encoded into the path, never spliced", async () => {
		const { api, requests } = transport(() =>
			Response.json({ tenant: "x", status: "revoked", code: "", org: null }),
		);
		await api.guardRevoke("a/b?c=d");
		expect(requests[0]?.url).toBe(
			`${BASE}/api/guard/orgs/a%2Fb%3Fc%3Dd/revoke`,
		);
	});
});

describe("the answer carries the card's digests and nothing else", () => {
	const granted = () =>
		Response.json({ approval_id: APPROVAL, state: "granted", tenant: TENANT });

	it("accept: exactly {request_digest, disclosure_digest}", async () => {
		const { api, requests } = transport(granted);
		await api.acceptGuardConsent(APPROVAL, {
			request_digest: DIGEST_A,
			disclosure_digest: DIGEST_B,
			// Extra keys a careless caller might pass must not reach the wire.
			...({ scopes: ["decisions"], tenant: TENANT, signature: "x" } as object),
		});
		expect(requests[0]?.init?.method).toBe("POST");
		expect(requests[0]?.url).toBe(
			`${BASE}/api/guard/consents/${APPROVAL}/accept`,
		);
		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
			request_digest: DIGEST_A,
			disclosure_digest: DIGEST_B,
		});
	});

	it("decline: no body at all", async () => {
		const { api, requests } = transport(granted);
		await api.declineGuardConsent(APPROVAL);
		expect(requests[0]?.url).toBe(
			`${BASE}/api/guard/consents/${APPROVAL}/decline`,
		);
		expect(requests[0]?.init?.body).toBeUndefined();
	});

	it("the card read is validated: a digest that is not sha256:<64 hex> is refused", async () => {
		const bad = { ...card(), request_digest: "sha256:short" };
		const { api } = transport(() => Response.json(bad));
		await expect(api.guardConsentCard(APPROVAL)).rejects.toMatchObject({
			kind: "malformed-frame",
		});
		const ok = transport(() => Response.json(card()));
		expect((await ok.api.guardConsentCard(APPROVAL)).request_digest).toBe(
			DIGEST_A,
		);
	});

	it("a status with no mode is refused, not read as 'no Guard'", async () => {
		const { mode: _mode, ...noMode } = status();
		const { api } = transport(() => Response.json(noMode));
		await expect(api.guardStatus()).rejects.toMatchObject({
			kind: "malformed-frame",
		});
	});

	it("unknown enum values pass through to the model layer", async () => {
		const body = status({ mode: "future_mode" });
		const { api } = transport(() => Response.json(body));
		expect((await api.guardStatus()).mode).toBe("future_mode");
		const nt = transport(() => Response.json(nonTeamStatus()));
		expect((await nt.api.guardStatus()).mode).toBe("non_team");
	});
});

/* --------------------------------------------------------------- source scans
 * Static guarantees about the whole app, because "the phone never talks to
 * Radient's Guard API" and "Guard sends no push" are claims about code that
 * does not exist, which only a scan of the source can hold. */

const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
			out.push(path);
	}
	return out;
}

describe("the phone never speaks to Radient's Guard API", () => {
	it("no shipped source names a /v1/guard path", () => {
		const offenders = walk(SRC).filter((file) =>
			/["'`]\/?v1\/guard|\/v1\/guard\//.test(
				readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
			),
		);
		expect(offenders).toEqual([]);
	});

	it("there is no grant method on the client, only an accept that echoes digests", () => {
		const names = Object.getOwnPropertyNames(RelayEndpoints.prototype).filter(
			(name) => /guard/i.test(name),
		);
		expect(names.sort()).toEqual(
			[
				"acceptGuardConsent",
				"declineGuardConsent",
				"guardConsentCard",
				"guardNonTeamCard",
				"guardRevoke",
				"guardShareAgain",
				"guardStatus",
			].sort(),
		);
	});
});
