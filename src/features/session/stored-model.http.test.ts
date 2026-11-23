import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelayClient } from "@/connection";
import { applyStoredModel, type StoredModelChoice } from "./use-stored-model";

const choice: StoredModelChoice = {
	model: {
		selector: "example/model-a",
		provider: "example",
		model_id: "model-a",
		name: "Model A",
		efforts: ["low", "high"],
	},
	effort: "high",
};
let server: Server | null = null;
afterEach(async () => {
	if (!server) return;
	const held = server;
	await new Promise<void>((resolve) => {
		held.close(() => resolve());
		held.closeAllConnections();
	});
	server = null;
});

/** This exercises actual client validation/serialization and HTTP, not a device
 * runtime. Core's cold-resume and command handling remain independent QA's lane. */
describe("stored model selection over the real relay client", () => {
	it("carries the selection before a prompt to the same session, using only existing routes", async () => {
		const requests: { path: string; body: unknown }[] = [];
		server = createServer(async (request, response) => {
			let data = "";
			for await (const chunk of request) data += String(chunk);
			const body = JSON.parse(data);
			requests.push({ path: request.url ?? "", body });
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify(
					request.url === "/api/sessions/resume"
						? { ok: true, session_id: "stored-session", pid: 42 }
						: { ok: true, detail: "accepted" },
				),
			);
		});
		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", resolve),
		);
		const port = (server.address() as AddressInfo).port;
		const client = createRelayClient({
			route: {
				mode: "custom",
				baseUrl: `http://127.0.0.1:${port}`,
				allowInsecure: true,
			},
		});
		await applyStoredModel(client, "stored-session", choice, true);
		await client.command("stored-session", {
			op: "prompt",
			command_id: randomUUID(),
			text: "continue here",
		});
		expect(requests).toEqual([
			{ path: "/api/sessions/resume", body: { session_id: "stored-session" } },
			{
				path: "/api/sessions/stored-session/command",
				body: { op: "set_model", provider: "example", model_id: "model-a" },
			},
			{
				path: "/api/sessions/stored-session/command",
				body: { op: "set_effort", effort: "high" },
			},
			{
				path: "/api/sessions/stored-session/command",
				body: {
					op: "prompt",
					command_id: expect.any(String),
					text: "continue here",
					inline_ui: true,
				},
			},
		]);
	});

	it.each(["set_model", "set_effort"])(
		"a %s refusal prevents message admission over HTTP",
		async (refusedOp) => {
			const received: string[] = [];
			server = createServer(async (request, response) => {
				let data = "";
				for await (const chunk of request) data += String(chunk);
				const body = JSON.parse(data);
				const op =
					request.url === "/api/sessions/resume" ? "resume" : String(body.op);
				received.push(op);
				response.writeHead(op === refusedOp ? 409 : 200, {
					"content-type": "application/json",
				});
				response.end(
					JSON.stringify(
						op === refusedOp
							? { error: "synthetic settings refusal" }
							: op === "resume"
								? { ok: true, session_id: "stored-session", pid: 42 }
								: { ok: true, detail: "accepted" },
					),
				);
			});
			await new Promise<void>((resolve) =>
				server?.listen(0, "127.0.0.1", resolve),
			);
			const port = (server.address() as AddressInfo).port;
			const client = createRelayClient({
				route: {
					mode: "custom",
					baseUrl: `http://127.0.0.1:${port}`,
					allowInsecure: true,
				},
			});
			await expect(
				(async () => {
					await applyStoredModel(client, "stored-session", choice, true);
					await client.command("stored-session", {
						op: "prompt",
						command_id: randomUUID(),
						text: "must not send",
					});
				})(),
			).rejects.toMatchObject({ status: 409 });
			expect(received).toEqual(
				refusedOp === "set_model"
					? ["resume", "set_model"]
					: ["resume", "set_model", "set_effort"],
			);
		},
	);

	it("rejects an unsupported effort before waking anything", async () => {
		const client = { command: vi.fn(), resumeSession: vi.fn() };
		await expect(
			applyStoredModel(
				client,
				"stored-session",
				{ ...choice, effort: "impossible" },
				true,
			),
		).rejects.toThrow("effort is not supported");
		expect(client.resumeSession).not.toHaveBeenCalled();
		expect(client.command).not.toHaveBeenCalled();
	});

	it("does not cross an ownership change while the resume is pending", async () => {
		let current = true;
		const client = {
			command: vi.fn(),
			resumeSession: vi.fn(async () => {
				current = false;
				return { ok: true as const, session_id: "stored-session", pid: 42 };
			}),
		};
		await expect(
			applyStoredModel(client, "stored-session", choice, true, () => {
				if (!current) throw new Error("route changed");
			}),
		).rejects.toThrow("route changed");
		expect(client.command).not.toHaveBeenCalled();
	});
});
