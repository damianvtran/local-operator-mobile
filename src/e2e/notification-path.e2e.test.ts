import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRelayClient } from "@/connection";
import { settlesCompletion } from "@/features/session/completion-ack";
import { createCookieJarFetch } from "@/testing/cookie-jar-fetch";
import { loadFixture } from "@/testing/fixtures";

/**
 * The notification path against the REAL mock relay, over a real socket.
 *
 * Nothing here is mocked: a `node tools/mock-relay/relay.ts` process serves the
 * captured corpus, the app's own client logs in through the cookie jar and
 * speaks the wire, and the assertions read the client's parsed payloads. This
 * is the outside-in half of the S1/S2/S4 evidence — the hook logic's own
 * transitions are unit-tested in `features/session/completion-ack.test.ts`,
 * which this suite complements with the wire it runs on:
 *
 *  - the frame-level `unread` block: count == the rows it describes, and a
 *    degraded attention store withholds `count` entirely (never 0);
 *  - the handle resolution route: a minted handle resolves, an unknown one is
 *    the clean 404;
 *  - the acknowledgement: a current token settles (through the app's own
 *    settlement predicate), a superseded one is refused with its machine code,
 *    and a landed receipt clears the mark on the next paint.
 *
 * Ctrl-C the fleet? No — the relay is spawned per suite, on port 0, and shut
 * down through its own control route in `afterAll`, with a kill by exact pid as
 * the backstop.
 */

const RELAY = fileURLToPath(
	new URL("../../tools/mock-relay/relay.ts", import.meta.url),
);
const PASSWORD = "notification-path-e2e";

let child: ChildProcess | null = null;
let base = "";
let client: ReturnType<typeof createRelayClient>;

/** The live fixtures the scenario's unread conversations are built from. */
interface ProjectionFixture {
	data: { attention?: { completion_token?: string | null } };
}

const seenFixture = loadFixture<{
	request: { method: string; path: string };
	body: { attention: { conversation_id: string; completion_token: string } };
}>("http/seen-real-token.json");
const resolveFixture = loadFixture<{
	request: { method: string; path: string };
	body: { session_id: string };
}>("http/push-conversation-ok.json");
const unknownFixture = loadFixture<{
	request: { method: string; path: string };
}>("http/push-conversation-unknown.json");
const deathFixture = loadFixture<ProjectionFixture>(
	"sse/sse-projection-durable-after-death.json",
);
const endedFixture = loadFixture<ProjectionFixture>(
	"sse/sse_projection_ended.json",
);

const handleOf = (path: string): string => path.split("/").pop() ?? "";
const sessionOf = (path: string): string => path.split("/")[3] ?? "";

async function control(path: string, body: unknown): Promise<void> {
	await fetch(`${base}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function selectScenario(scenario: string): Promise<void> {
	await control("/__mock/scenario", { scenario });
}

beforeAll(async () => {
	const port = await new Promise<number>((resolve, reject) => {
		const launched = spawn(
			process.execPath,
			[RELAY, "--port", "0", "--print-port", "--quiet", "--password", PASSWORD],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		child = launched;
		let buffered = "";
		const timer = setTimeout(
			() => reject(new Error("the mock relay never printed its port")),
			15_000,
		);
		launched.stdout?.on("data", (chunk: Buffer) => {
			buffered += chunk.toString();
			const line = buffered.split("\n")[0] ?? "";
			const value = Number.parseInt(line.trim(), 10);
			if (Number.isFinite(value) && value > 0) {
				clearTimeout(timer);
				resolve(value);
			}
		});
		launched.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		launched.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`the mock relay exited early: ${String(code)}`));
		});
	});
	base = `http://127.0.0.1:${port}`;
	const jar = createCookieJarFetch();
	client = createRelayClient({
		route: { mode: "custom", baseUrl: base, allowInsecure: true },
		fetchImpl: jar.fetch,
	});
	const login = await client.login(PASSWORD);
	expect(login.signedIn).toBe(true);
}, 30_000);

afterAll(async () => {
	try {
		await fetch(`${base}/__mock/shutdown`, { method: "POST" });
	} catch {
		// The control route is best-effort; the kill below is the guarantee.
	}
	const exited = child;
	child = null;
	if (exited && exited.exitCode === null && exited.signalCode === null) {
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				exited.kill("SIGKILL");
				resolve();
			}, 3_000);
			exited.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
}, 20_000);

describe("the frame-level unread block (S1)", () => {
	it("carries a count equal to the unseen rows of the same frame", async () => {
		await selectScenario("unread");
		const frame = await client.sessions();
		expect(frame.sessions).toHaveLength(3);
		const unseen = frame.sessions.filter((row) => row.unseen === true);
		expect(unseen).toHaveLength(2);
		expect(frame.unread?.degraded).toEqual([]);
		expect(frame.unread?.count).toBe(2);
	});

	it("withholds the count entirely when the attention store is degraded", async () => {
		await selectScenario("degraded-attention");
		const frame = await client.sessions();
		expect(frame.unread?.degraded).toEqual(["attention"]);
		// Never 0: a store that could not be read is not an empty pile.
		expect(frame.unread?.count).toBeUndefined();
	});
});

describe("the handle resolution route (S2)", () => {
	it("resolves a captured handle to its conversation", async () => {
		const answer = await client.resolveConversation(
			handleOf(resolveFixture.request.path),
		);
		expect(answer.session_id).toBe(resolveFixture.body.session_id);
	});

	it("answers the clean 404 for a handle it did not mint", async () => {
		await expect(
			client.resolveConversation(handleOf(unknownFixture.request.path)),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("the acknowledgement (S4)", () => {
	it("settles on the current token through the app's own settlement check", async () => {
		await selectScenario("idle");
		const session = sessionOf(seenFixture.request.path);
		const token = seenFixture.body.attention.completion_token;
		const answer = await client.seen(session, token);
		expect(
			settlesCompletion(answer.attention, {
				conversationId: `session/${session}`,
				token,
			}),
		).toBe(true);
	});

	it("refuses a superseded token with the machine code the app branches on", async () => {
		await selectScenario("idle");
		const session = sessionOf(seenFixture.request.path);
		await expect(
			client.seen(session, "00000000-0000-4000-8000-000000000000"),
		).rejects.toMatchObject({
			status: 409,
			code: "superseded_completion_token",
		});
	});

	it("clears the acked conversation's mark on the next paint", async () => {
		await selectScenario("unread");
		const before = await client.sessions();
		expect(before.unread?.count).toBe(2);
		const unseen = before.sessions.filter((row) => row.unseen === true);
		/* The scenario's two unread conversations are built from the after-death
		 * and ended captures, whose completion tokens the corpus holds. The mock
		 * refuses any token that is not the addressed conversation's own, so
		 * trying the two corpus tokens finds the pair without the test
		 * re-deriving the scenario's mint. */
		const tokens = [
			deathFixture.data.attention?.completion_token ?? "",
			endedFixture.data.attention?.completion_token ?? "",
		];
		let acked = false;
		for (const row of unseen) {
			for (const token of tokens) {
				if (token === "") continue;
				try {
					await client.seen(row.session_id, token);
					acked = true;
					break;
				} catch {
					// The other conversation's token: refused, as the wire says it must be.
				}
			}
			if (acked) break;
		}
		expect(acked).toBe(true);
		const after = await client.sessions();
		expect(after.unread?.count).toBe(1);
		expect(after.sessions.filter((row) => row.unseen === true)).toHaveLength(1);
	});
});

/**
 * The push device registry's routes (S4a), driven through the app's own client.
 *
 * The app does not CALL registration yet (the cloud forward is S7, unbuilt —
 * the gate is recorded on `registerDevice` and in the PR), so this suite is the
 * client half's proof: the wire shapes validate, the register upsert keeps its
 * record's identity, the revoke tombstone sticks, and a revoked device is
 * refused with the machine's own code. The mock models these routes from the
 * core's source (`push_devices.py`); its provenance note is in `relay.ts`.
 */
describe("the push device registry (S4a)", () => {
	const INSTALL_ID = "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9";
	let registeredDeviceId = "";

	it("registers a device, minting the key in the response", async () => {
		const first = await client.registerDevice({
			platform: "ios",
			token: "apns-token-1",
			environment: "sandbox",
			app_version: "0.0.0",
			install_id: INSTALL_ID,
		});
		expect(first.ok).toBe(true);
		expect(first.device_key.length).toBeGreaterThan(0);
		registeredDeviceId = first.device_id;
	});

	it("re-registering with a rotated token keeps the row's identity", async () => {
		const second = await client.registerDevice({
			platform: "ios",
			token: "apns-token-2",
			environment: "sandbox",
			app_version: "0.0.0",
			install_id: INSTALL_ID,
		});
		/* The idempotency is the upsert: same device_id, same registered_at —
		 * "the same device" is the row, not the request. */
		expect(second.device_id).toBe(registeredDeviceId);
	});

	it("lists the device as live, with the core's precedence string", async () => {
		const list = await client.pushDevices();
		const row = list.devices.find(
			(device) => device.device_id === registeredDeviceId,
		);
		expect(row?.state).toBe("live");
		expect(row?.platform).toBe("ios");
		expect(list.precedence).toBe("revoked > unpaired > expired");
	});

	it("revokes as a tombstone — the row stays, its state moves", async () => {
		const removed = await client.revokePushDevice(registeredDeviceId);
		expect(removed.ok).toBe(true);
		const after = await client.pushDevices();
		expect(
			after.devices.find((device) => device.device_id === registeredDeviceId)
				?.state,
		).toBe("revoked");
	});

	it("refuses to re-register a revoked device with the machine's code", async () => {
		await expect(
			client.registerDevice({
				platform: "ios",
				token: "apns-token-3",
				environment: "sandbox",
				app_version: "0.0.0",
				install_id: INSTALL_ID,
			}),
		).rejects.toMatchObject({ status: 403, code: "device_revoked" });
	});

	it("refuses an invalid registration body", async () => {
		await expect(
			client.registerDevice({
				platform: "ios",
				token: "",
				environment: "sandbox",
				app_version: "0.0.0",
				install_id: "another-install",
			}),
		).rejects.toMatchObject({ status: 422 });
	});

	it("revoking an id the registry does not hold is still ok — the retry must not fail", async () => {
		const answer = await client.revokePushDevice("dev-nonexistent");
		expect(answer.ok).toBe(true);
	});
});
