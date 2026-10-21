import { describe, expect, it } from "vitest";
import { createHubClient } from "@/team-bridge/client";
import { retirementAccessForAccount } from "@/team-bridge/push-account";

const jwt = (sub: string, exp: number) =>
	`h.${btoa(JSON.stringify({ sub, exp }))}.s`;
const future = () => Math.floor(Date.now() / 1000) + 300;

describe("account-bound retirement credentials", () => {
	it("uses a fresh same-account bearer after the registered bearer expired", async () => {
		const expired = jwt("account-a", 1);
		const fresh = jwt("account-a", future());
		const headers: string[] = [];
		const hub = createHubClient({
			accessToken: retirementAccessForAccount(expired, async () => fresh),
			fetchImpl: (async (_url, init) => {
				headers.push(new Headers(init?.headers).get("authorization") ?? "");
				return new Response(null, { status: 204 });
			}) as typeof fetch,
		});
		await hub.unregisterDevice("install-a", 101);
		expect(headers).toEqual([`Bearer ${fresh}`]);
	});

	it("never borrows a replacement account's token; expired original cannot be retried", async () => {
		const access = retirementAccessForAccount(jwt("account-a", 1), async () =>
			jwt("account-b", future()),
		);
		expect(await access()).toBeNull();
		expect(await access({ force: true })).toBeNull();
	});

	it("an unexpired original may still clean up its old account after replacement", async () => {
		const original = jwt("account-a", future());
		const access = retirementAccessForAccount(original, async () =>
			jwt("account-b", future()),
		);
		expect(await access()).toBe(original);
	});

	it("the 401 retry refreshes the same account instead of replaying the captured token", async () => {
		const original = jwt("account-a", 1),
			first = jwt("account-a", future()),
			second = jwt("account-a", future() + 1);
		const seen: string[] = [];
		const hub = createHubClient({
			accessToken: retirementAccessForAccount(original, async (options) =>
				options?.force ? second : first,
			),
			fetchImpl: (async (_url, init) => {
				seen.push(new Headers(init?.headers).get("authorization") ?? "");
				return seen.length === 1
					? new Response("{}", { status: 401 })
					: new Response(null, { status: 204 });
			}) as typeof fetch,
		});
		await hub.unregisterDevice("install-a", 102);
		expect(seen).toEqual([`Bearer ${first}`, `Bearer ${second}`]);
	});
});
