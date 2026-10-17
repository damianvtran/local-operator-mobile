import { describe, expect, it } from "vitest";
import { type Payload, parsePayload } from "../../contracts";
import backendProjection from "../../features/settings/__fixtures__/account-routing.core.json";
import { RelayEndpoints, RelayHttpClient } from "../index";

const BASE = "https://synthetic-computer.example.invalid";
function required<T>(value: T | undefined): T {
	if (value === undefined)
		throw new Error("missing expected transport fixture entry");
	return value;
}

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

const projectedPolicy = (): Payload<"accountRouting"> =>
	parsePayload("accountRouting", structuredClone(backendProjection));

describe("the selected-computer account-routing contract", () => {
	it("uses authenticated shared transport and the narrow GET/PATCH body only", async () => {
		const fixture = projectedPolicy();
		const { api, requests } = transport(() => Response.json(fixture));
		expect(await api.accountRouting()).toEqual(fixture);
		expect(await api.setAccountRouting(fixture.setting.value)).toEqual(fixture);
		expect(requests.map(({ url, init }) => [url, init?.method])).toEqual([
			[`${BASE}/api/settings/account-routing`, "GET"],
			[`${BASE}/api/settings/account-routing`, "PATCH"],
		]);
		expect(required(requests[0]).init?.body).toBeUndefined();
		expect(JSON.parse(String(required(requests[1]).init?.body))).toEqual({
			value: fixture.setting.value,
		});
		expect(requests.every(({ init }) => init?.credentials === "omit")).toBe(
			true,
		);
	});

	it("preserves backend text and accepts a future server choice without a phone enum", async () => {
		const payload = projectedPolicy();
		payload.setting.label = "Sélection du compte — backend text";
		payload.setting.help = "Texte fourni par cet ordinateur.";
		payload.setting.choices.push({
			value: "future-policy",
			label: "Future server label",
			description: "Future server description",
		});
		payload.setting.value = "future-policy";
		payload.setting.is_default = false;
		const { api } = transport(() => Response.json(payload));
		expect(await api.accountRouting()).toEqual(payload);
	});

	it.each([
		[
			"missing capability",
			(payload: Record<string, unknown>) => {
				delete payload.capability;
			},
		],
		[
			"wrong capability",
			(payload: Record<string, unknown>) => {
				payload.capability = "not-account-routing";
			},
		],
	])(
		"refuses %s instead of fabricating a usable setting",
		async (_name, mutate) => {
			const payload = structuredClone(backendProjection);
			mutate(payload);
			const { api } = transport(() => Response.json(payload));
			await expect(api.accountRouting()).rejects.toMatchObject({
				kind: "malformed-frame",
			});
		},
	);

	it.each([
		"empty",
		"duplicate",
		"missing-value",
		"wrong-key",
		"wrong-default-flag",
	])("refuses inconsistent %s metadata", async (mutation) => {
		const payload = structuredClone(backendProjection);
		if (mutation === "empty") payload.setting.choices = [];
		if (mutation === "duplicate")
			payload.setting.choices.push({ ...required(payload.setting.choices[0]) });
		if (mutation === "missing-value") payload.setting.value = "not-advertised";
		if (mutation === "wrong-key")
			payload.setting.key = "unrelated.security.setting";
		if (mutation === "wrong-default-flag")
			payload.setting.is_default = !payload.setting.is_default;
		const { api } = transport(() => Response.json(payload));
		await expect(api.accountRouting()).rejects.toMatchObject({
			kind: "malformed-frame",
		});
	});

	it("preserves canonical backend refusal text rather than inventing wire descriptors", async () => {
		const { api } = transport(() =>
			Response.json(
				{ code: "invalid_setting", error: "Synthetic backend refusal." },
				{ status: 422 },
			),
		);
		await expect(api.setAccountRouting("invalid-value")).rejects.toMatchObject({
			status: 422,
			code: "invalid_setting",
			serverError: "Synthetic backend refusal.",
		});
	});
});
