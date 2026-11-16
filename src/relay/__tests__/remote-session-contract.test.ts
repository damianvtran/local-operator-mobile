import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryWindow } from "@/features/session/history-window";
import { fixtureBody } from "@/testing/fixture-relay";
import { RelayEndpoints } from "../endpoints";
import { RelayHttpClient } from "../http";
import { memoryEnvelopeStore, RetryEnvelopeStore } from "../retry-envelope";
import { sendPersistedCommand } from "../send-command";
import type { DecodedFrame } from "../sse";

/** Native transport contract, not a mesh implementation. Two synthetic owner
 * session ids are served by ONE admitted relay. Mesh authorization itself is
 * independently exercised by Core; the phone never contacts either peer. */
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) await close();
});
async function relay() {
	const requests: {
		path: string;
		cookie?: string;
		body?: unknown;
		ownerHeader?: string | string[];
	}[] = [];
	const template = (
		fixtureBody("http/history-ok.json") as {
			entries: Record<string, unknown>[];
		}
	).entries[0];
	const rows = Array.from({ length: 6 }, (_, index) => ({
		...template,
		id: `journal-${index}`,
		text: `Synthetic owner message ${index}`,
	}));
	let denied = false;
	let ambiguous = false;
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://relay.invalid");
		let text = "";
		for await (const chunk of request) text += String(chunk);
		requests.push({
			path: request.url ?? "",
			cookie: request.headers.cookie,
			body: text ? JSON.parse(text) : undefined,
			ownerHeader: request.headers["x-owner-device"],
		});
		const answer = (status: number, body: unknown) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (request.headers.cookie !== "synthetic-phone=admitted") {
			answer(401, { error: "authentication required" });
			return;
		}
		if (denied) {
			answer(403, {
				error: "remote_forbidden",
				code: "remote_forbidden",
				remote: true,
			});
			return;
		}
		if (url.pathname.endsWith("/history")) {
			const before = url.searchParams.get("before");
			const end = before
				? rows.findIndex((row) => row.id === before)
				: rows.length;
			const start = Math.max(0, end - 2);
			answer(200, { entries: rows.slice(start, end), has_more: start > 0 });
			return;
		}
		if (url.pathname.endsWith("/events")) {
			const projection = structuredClone(
				fixtureBody("sse/sse-projection-checkpoints-empty.json"),
			) as Record<string, unknown>;
			projection.session_id = url.pathname.split("/")[3];
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(
				`event: projection\ndata: ${JSON.stringify(projection)}\n\n`,
			);
			request.on("close", () => response.end());
			return;
		}
		if (url.pathname.endsWith("/command")) {
			if (ambiguous) {
				answer(409, {
					error: "remote_command_ambiguous",
					code: "remote_command_ambiguous",
					remote: true,
				});
				return;
			}
			answer(200, { ok: true, detail: "synthetic owner admitted command" });
			return;
		}
		const video = url.searchParams.get("kind") === "video";
		const file =
			url.pathname.endsWith("/file") || url.searchParams.get("kind") === "file";
		if (
			url.searchParams.get("kind") === "file" &&
			url.searchParams.get("i") !== "3"
		) {
			answer(404, { error: "no such attachment" });
			return;
		}
		response.writeHead(200, {
			"content-type": video ? "video/mp4" : file ? "text/plain" : "image/png",
		});
		response.end(
			Buffer.from(
				video
					? "synthetic-video-bytes"
					: file
						? "synthetic-file-bytes"
						: "synthetic-image-bytes",
			),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	closes.push(
		() =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	);
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const client = new RelayEndpoints(
		new RelayHttpClient({
			baseUrl,
			auth: () => ({
				cookie: "synthetic-phone=admitted",
				origin: baseUrl,
				credentials: "omit",
			}),
		}),
	);
	return {
		client,
		requests,
		deny: () => {
			denied = true;
		},
		ambiguous: () => {
			ambiguous = true;
		},
	};
}

const firstProjection = async (
	client: RelayEndpoints,
	id: string,
): Promise<DecodedFrame> => {
	let stop: () => void = () => undefined;
	try {
		return await new Promise<DecodedFrame>((resolve, reject) => {
			const stream = client.sessionStream(id, {
				onFrame: resolve,
				onError: reject,
			});
			stop = stream.stop;
			stream.connection.start();
		});
	} finally {
		stop();
	}
};

describe("remote conversations use ordinary admitted relay routes", () => {
	it("reads live/stopped owners to the beginning, reconnects snapshots, and forwards text/images/UUID/media without peer authority", async () => {
		const { client, requests } = await relay();
		for (const id of ["synthetic-live-owner", "synthetic-stopped-owner"]) {
			const history = new HistoryWindow(
				(before) => client.history(id, { before }),
				() => undefined,
			);
			history.activate();
			await history.load();
			await history.load();
			await history.load();
			expect(history.visibleRows.map((row) => row.id)).toEqual(
				Array.from({ length: 6 }, (_, index) => `journal-${index}`),
			);
			expect(history.hasGap).toBe(false);
			history.retire();
			expect((await firstProjection(client, id)).kind).toBe("projection");
			expect((await firstProjection(client, id)).kind).toBe("projection");
			for (const op of ["prompt", "steer"] as const) {
				const body = {
					op,
					text: "synthetic instruction",
					command_id:
						op === "prompt"
							? "11111111-1111-4111-8111-111111111111"
							: "22222222-2222-4222-8222-222222222222",
					images: [{ data_b64: "c3ludGhldGlj", mime_type: "image/png" }],
				};
				expect((await client.command(id, body)).ok).toBe(true);
				expect(requests.at(-1)?.body).toEqual(body);
			}
			expect(
				new TextDecoder().decode(
					(await client.image(id, "journal-0", 0)).bytes,
				),
			).toBe("synthetic-image-bytes");
			expect(
				new TextDecoder().decode(
					(await client.video(id, "journal-0", 0)).bytes,
				),
			).toBe("synthetic-video-bytes");
			expect(
				new TextDecoder().decode(
					(await client.supplementFile(id, "synthetic-job", 0)).bytes,
				),
			).toBe("synthetic-file-bytes");
			expect(
				new TextDecoder().decode(
					(await client.file(id, "historical-document-row", 3)).bytes,
				),
			).toBe("synthetic-file-bytes");
			expect(requests.at(-1)?.path).toBe(
				`/api/sessions/${id}/attachment?kind=file&entry=historical-document-row&i=3`,
			);
			await expect(
				client.file(id, "historical-document-row", 0),
			).rejects.toMatchObject({ status: 404 });
		}
		expect(
			requests.every((request) =>
				request.path.startsWith("/api/sessions/synthetic-"),
			),
		).toBe(true);
		expect(
			requests.every(
				(request) =>
					request.cookie === "synthetic-phone=admitted" &&
					request.ownerHeader === undefined,
			),
		).toBe(true);
		console.info(
			`PASS relay-only transport: ${requests.length} authenticated requests; two owner ids, history beginning, snapshot reopen, prompt/steer UUID+images, image/file/video bytes`,
		);
	});
	it("does not log out or replay on a peer refusal/ambiguous ack; keeps loaded history", async () => {
		const server = await relay();
		const history = new HistoryWindow(
			(before) => server.client.history("synthetic-owner", { before }),
			() => undefined,
		);
		history.activate();
		await history.load();
		const held = history.visibleRows.map((row) => row.id);
		server.ambiguous();
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		await expect(
			sendPersistedCommand({
				client: server.client,
				envelopes,
				sessionId: "synthetic-owner",
				op: "steer",
				text: "hold",
			}),
		).rejects.toMatchObject({
			code: "remote_command_ambiguous",
			retry: "never",
			envelope: "keep",
		});
		expect(
			server.requests.filter((request) => request.path.endsWith("/command")),
		).toHaveLength(1);
		const heldCommand = await envelopes.peek("synthetic-owner");
		const sentBody = server.requests.find((request) =>
			request.path.endsWith("/command"),
		)?.body as { command_id: string };
		expect(heldCommand?.command_id).toBe(sentBody.command_id);
		expect(heldCommand?.op).toBe("steer");
		server.deny();
		await history.load();
		expect(history.visibleRows.map((row) => row.id)).toEqual(held);
		await expect(
			server.client.image("synthetic-owner", "journal-0", 0),
		).rejects.toMatchObject({
			code: "remote_forbidden",
			kind: "rejected",
			surface: "none",
		});
		await expect(
			server.client.file("synthetic-owner", "historical-document-row", 3),
		).rejects.toMatchObject({
			code: "remote_forbidden",
			kind: "rejected",
			surface: "none",
		});
		history.retire();
		console.info(
			"PASS peer403 remains operation-local for historical files; loaded history retained; ambiguous409 is one command request, UUID retained, no automatic retry",
		);
	});
});
