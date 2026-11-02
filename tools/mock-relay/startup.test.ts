import { afterEach, describe, expect, it } from "vitest";
import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";
import { createStartupEvidence, STARTUP_LIMITS } from "./startup.ts";

const rigs: ReturnType<typeof createRelay>[] = [];
async function start(faults: string[] = []) {
	const relay = createRelay({ scenario: "idle", faults, quiet: true });
	rigs.push(relay);
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(`${url}/login`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
	return {
		url,
		request: (
			path: string,
			body?: unknown,
			extraHeaders: Record<string, string> = {},
		) =>
			fetch(`${url}${path}`, {
				method: body === undefined ? "GET" : "POST",
				redirect: "manual",
				signal: AbortSignal.timeout(2500),
				headers: {
					cookie,
					"content-type": "application/json",
					...extraHeaders,
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
	};
}
afterEach(async () => {
	await Promise.all(rigs.splice(0).map((relay) => relay.shutdown()));
});

describe("startup evidence over the real relay socket", () => {
	it("creates a distinct adoptable session for each legacy start POST", async () => {
		const rig = await start();
		const first = await (
			await rig.request("/api/sessions/start", {
				provider: "synthetic",
				model: "synthetic",
			})
		).json();
		const second = await (
			await rig.request("/api/sessions/start", {
				provider: "synthetic",
				model: "synthetic",
			})
		).json();
		expect(first.session_id).toBeTruthy();
		expect(second.session_id).not.toBe(first.session_id);
		expect((await firstProjection(rig, first.session_id)).session_id).toBe(
			first.session_id,
		);
		expect((await firstProjection(rig, second.session_id)).session_id).toBe(
			second.session_id,
		);
		expect(
			(await (await rig.request("/api/sessions")).json()).sessions,
		).toHaveLength(3);
		const evidence = await (await rig.request("/__mock/startup")).json();
		expect(
			evidence.createdSessions.map(
				(row: { sessionId: string }) => row.sessionId,
			),
		).toEqual([first.session_id, second.session_id]);
	});

	it("keeps the admitted row and immutable image evidence after a lost ack and retry", async () => {
		const rig = await start(["no-ack=1"]);
		const sessions = await (await rig.request("/api/sessions")).json();
		const sid = sessions.sessions[0].session_id;
		const command = {
			op: "prompt",
			command_id: "00000000-0000-4000-8000-000000000001",
			text: "synthetic admission",
			images: [
				{
					data_b64:
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
					mime_type: "image/png",
				},
			],
		};
		expect(
			(await rig.request(`/api/sessions/${sid}/command`, command)).status,
		).toBe(504);
		const projection = await firstProjection(rig, sid);
		expect(
			projection.transcript.filter(
				(row: { id: string }) => row.id === `user-${command.command_id}`,
			),
		).toHaveLength(1);
		expect(
			(
				await rig.request(`/api/sessions/${sid}/command`, {
					...command,
					text: "changed replay",
				})
			).status,
		).toBe(200);
		const evidence = await (await rig.request("/__mock/startup")).json();
		expect(evidence.admissions).toHaveLength(1);
		expect(evidence.admissions[0].body).toEqual(command);
		expect(evidence.admissions[0].rawBody).toBe(JSON.stringify(command));
		const image = await rig.request(
			`/api/sessions/${sid}/image?entry=user-${command.command_id}&i=0`,
		);
		expect(image.status).toBe(200);
		expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(
			command.images[0]?.data_b64,
		);
		expect(
			(
				await rig.request(
					`/api/sessions/${sid}/image?entry=user-${command.command_id}&i=1`,
				)
			).status,
		).toBe(404);
		expect(
			(await firstProjection(rig, sid)).transcript.filter(
				(row: { id: string }) => row.id === `user-${command.command_id}`,
			),
		).toHaveLength(1);
		expect(evidence.admissions[0].images[0].sha256).toBe(
			"a4bcd7b80c65e14e3809783fc4c587ce66a995dcc142e25bf61c9337ef6f3443",
		);
	});

	it("holds a selected start ack after creation, then drops only its reply", async () => {
		const rig = await start();
		expect(
			(
				await rig.request("/__mock/barriers", {
					id: "create-ack",
					point: "start-ack",
				})
			).status,
		).toBe(201);
		const pending = rig
			.request("/api/sessions/start", { cwd: "/synthetic/workspace" })
			.then(
				() => "answered",
				() => "dropped",
			);
		await expect
			.poll(
				async () =>
					(await (await rig.request("/__mock/startup")).json()).barriers[0]
						?.state,
			)
			.toBe("entered");
		const evidence = await (await rig.request("/__mock/startup")).json();
		expect(evidence.createdSessions).toHaveLength(1);
		const sid = evidence.createdSessions[0].sessionId;
		expect((await firstProjection(rig, sid)).session_id).toBe(sid);
		expect(
			(
				await rig.request("/__mock/barriers/create-ack/release", {
					outcome: "drop",
				})
			).status,
		).toBe(200);
		expect(await pending).toBe("dropped");
		expect(
			(await (await rig.request("/__mock/startup")).json()).createdSessions,
		).toHaveLength(1);
	});

	it("holds only the selected authenticated config path and releases once", async () => {
		const rig = await start();
		await rig.request("/__mock/barriers", {
			id: "models",
			point: "config",
			path: "/api/models",
		});
		expect(
			(
				await fetch(`${rig.url}/api/models`, {
					signal: AbortSignal.timeout(1000),
				})
			).status,
		).toBe(401);
		expect(
			(await (await rig.request("/__mock/startup")).json()).barriers[0].state,
		).toBe("armed");
		expect((await rig.request("/api/directories")).status).toBe(200);
		const pending = rig.request("/api/models");
		await entered(rig, "models");
		expect((await rig.request("/api/sessions")).status).toBe(200);
		await rig.request("/__mock/barriers/models/release", {});
		expect((await pending).status).toBe(200);
		expect((await rig.request("/api/models")).status).toBe(200);
	});

	it("exposes before-create separately from after-admission and cancels stale writes on reset", async () => {
		const rig = await start();
		await rig.request("/__mock/barriers", { id: "before", point: "start" });
		expect(
			(
				await fetch(`${rig.url}/api/sessions/start`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
					signal: AbortSignal.timeout(1000),
				})
			).status,
		).toBe(401);
		expect(
			(
				await rig.request(
					"/api/sessions/start",
					{},
					{ origin: "https://untrusted.example" },
				)
			).status,
		).toBe(403);
		expect(
			(await (await rig.request("/__mock/startup")).json()).barriers[0].state,
		).toBe("armed");
		const pending = rig.request("/api/sessions/start", {}).then(
			() => "answered",
			() => "dropped",
		);
		await entered(rig, "before");
		expect(
			(await (await rig.request("/__mock/startup")).json()).createdSessions,
		).toHaveLength(0);
		await rig.request("/__mock/reset", {});
		expect(await pending).toBe("dropped");
		const reset = await (await rig.request("/__mock/startup")).json();
		expect(reset.barriers).toEqual([]);
		expect(reset.createdSessions).toEqual([]);
		expect(
			(await (await rig.request("/api/sessions")).json()).sessions,
		).toHaveLength(1);
		await rig.request("/__mock/barriers", {
			id: "before-again",
			point: "start",
		});
		const released = rig.request("/api/sessions/start", {});
		await entered(rig, "before-again");
		await rig.request("/__mock/barriers/before-again/release", {});
		expect((await released).status).toBe(200);
		expect(
			(await (await rig.request("/__mock/startup")).json()).createdSessions,
		).toHaveLength(1);
	});

	it("records command effect before a selected ack drop, without blocking unrelated commands or replay", async () => {
		const rig = await start();
		const sid = (await (await rig.request("/api/sessions/start", {})).json())
			.session_id;
		const id = "00000000-0000-4000-8000-000000000002";
		await rig.request("/__mock/barriers", {
			id: "command",
			point: "command-ack",
			sessionId: sid,
			commandId: id,
		});
		const command = { op: "prompt", text: "held", command_id: id };
		const pending = rig.request(`/api/sessions/${sid}/command`, command).then(
			() => "answered",
			() => "dropped",
		);
		await entered(rig, "command");
		expect((await firstProjection(rig, sid)).transcript).toHaveLength(1);
		expect(
			(await rig.request(`/api/sessions/${sid}/command`, command)).status,
		).toBe(200);
		expect(
			(
				await rig.request(`/api/sessions/${sid}/command`, {
					...command,
					command_id: "00000000-0000-4000-8000-000000000003",
				})
			).status,
		).toBe(200);
		await rig.request("/__mock/barriers/command/release", { outcome: "drop" });
		expect(await pending).toBe("dropped");
		expect((await firstProjection(rig, sid)).transcript).toHaveLength(2);
		expect(
			(await (await rig.request("/__mock/startup")).json()).admissions,
		).toHaveLength(2);
		await rig.request("/__mock/scenario", { scenario: "idle" });
		expect(
			(await (await rig.request("/__mock/startup")).json()).admissions,
		).toEqual([]);
	});

	it("cancels an unacknowledged command on reset without retaining the previous world's ledger", async () => {
		const rig = await start(["no-ack-forever"]);
		const sid = (await (await rig.request("/api/sessions")).json()).sessions[0]
			.session_id;
		const pending = rig
			.request(`/api/sessions/${sid}/command`, {
				op: "prompt",
				text: "reset pending",
				command_id: "00000000-0000-4000-8000-000000000004",
			})
			.then(
				() => "answered",
				() => "dropped",
			);
		await expect
			.poll(
				async () =>
					(await (await rig.request("/__mock/startup")).json()).admissions
						.length,
			)
			.toBe(1);
		await rig.request("/__mock/reset", {});
		// A dead socket must be reaped by reset, not merely by our request timeout.
		await expect
			.poll(async () => Promise.race([pending, Promise.resolve("pending")]), {
				timeout: 500,
			})
			.toBe("dropped");
		expect(
			(await (await rig.request("/__mock/startup")).json()).admissions,
		).toEqual([]);
	});

	it("bounds held requests and rejects invalid commands before entering ack barriers", async () => {
		const rig = await start();
		const sid = (await (await rig.request("/api/sessions")).json()).sessions[0]
			.session_id;
		await rig.request("/__mock/barriers", {
			id: "invalid",
			point: "command-ack",
		});
		expect(
			(
				await rig.request(`/api/sessions/${sid}/command`, {
					op: "prompt",
					text: "invalid",
					command_id: "bad",
				})
			).status,
		).toBe(422);
		expect(
			(await (await rig.request("/__mock/startup")).json()).barriers[0].state,
		).toBe("armed");
		await rig.request("/__mock/barriers", {
			id: "expire",
			point: "config",
			timeoutMs: 250,
		});
		const pending = rig.request("/api/models");
		await entered(rig, "expire");
		expect((await pending).status).toBe(504);
		expect(
			(await (await rig.request("/__mock/startup")).json()).barriers[1].state,
		).toBe("expired");
	});
});

describe("bounded per-scenario startup ledger", () => {
	it("fails closed at capacity instead of evicting idempotency evidence", () => {
		const ledger = createStartupEvidence();
		try {
			for (let i = 0; i < STARTUP_LIMITS.barriers; i++)
				ledger.arm({ id: `b${i}`, point: "start" });
			expect(() => ledger.arm({ id: "overflow", point: "start" })).toThrow(
				"capacity",
			);
			for (let i = 0; i < STARTUP_LIMITS.admissions; i++)
				expect(
					ledger.admit(
						"synthetic",
						String(i),
						{ op: "prompt", text: "first" },
						"{}",
					),
				).toBe(true);
			expect(ledger.admit("synthetic", "overflow", {}, "{}")).toBe(false);
			expect(ledger.admit("synthetic", "0", { text: "changed" }, "{}")).toBe(
				true,
			);
			expect(ledger.snapshot().admissions[0]?.body.text).toBe("first");
			for (let i = 0; i < STARTUP_LIMITS.sessions; i++)
				expect(ledger.create(String(i), {}, "{}")).toBe(true);
			expect(ledger.create("overflow", {}, "{}")).toBe(false);
			ledger.reset();
			expect(ledger.snapshot().retainedBytes).toBe(0);
			expect(
				ledger.admit(
					"synthetic",
					"too-many-images",
					{ images: Array.from({ length: 65 }, () => ({})) },
					"{}",
				),
			).toBe(false);
			expect(
				ledger.admit(
					"synthetic",
					"oversize",
					{ text: "x".repeat(STARTUP_LIMITS.bytes) },
					"{}",
				),
			).toBe(false);
			expect(ledger.snapshot().admissions).toEqual([]);
		} finally {
			ledger.reset();
		}
	});
});

async function entered(rig: Awaited<ReturnType<typeof start>>, id: string) {
	await expect
		.poll(
			async () =>
				(await (await rig.request("/__mock/startup")).json()).barriers.find(
					(barrier: { id: string }) => barrier.id === id,
				)?.state,
		)
		.toBe("entered");
}

async function firstProjection(
	rig: Awaited<ReturnType<typeof start>>,
	sid: string,
) {
	const response = await rig.request(`/api/sessions/${sid}/events`);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("SSE body missing");
	let text = "";
	try {
		while (!text.includes("\n\n")) {
			const chunk = await reader.read();
			if (chunk.done) throw new Error("SSE ended without a projection");
			text += new TextDecoder().decode(chunk.value);
		}
	} finally {
		await reader.cancel();
	}
	return JSON.parse(
		text
			.split("\n")
			.find((line) => line.startsWith("data:"))
			?.slice(5) ?? "null",
	);
}
