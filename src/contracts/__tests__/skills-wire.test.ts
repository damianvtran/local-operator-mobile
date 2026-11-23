import { describe, expect, it } from "vitest";

import { parsePayload } from "@/contracts";
import { sessionCapabilities } from "@/features/sessions/session-navigation";

/**
 * The `$skill` contract's three wire facts: the TOP-LEVEL capability (absent =
 * older relay, never defaulted, and not `remote_sessions.skill_invocation`), the
 * catalogue rows, and the ack's additive `skills` block.
 */
const frame = (capabilities: Record<string, unknown>) =>
	parsePayload("sessionListFrame", {
		sessions: [],
		degraded: [],
		capabilities,
	});

describe("capabilities.skill_invocation", () => {
	it("is absent on an older relay and is never defaulted to available", () => {
		expect(frame({}).capabilities.skill_invocation).toBeUndefined();
	});
	it("reads a stated one", () => {
		expect(
			frame({ skill_invocation: { available: true } }).capabilities
				.skill_invocation,
		).toEqual({ available: true });
		expect(
			frame({ skill_invocation: { available: false } }).capabilities
				.skill_invocation,
		).toEqual({ available: false });
	});
	it("is NOT the remote-sessions flag", () => {
		const parsed = frame({
			remote_sessions: { available: true, skill_invocation: true },
		});
		expect(parsed.capabilities.skill_invocation).toBeUndefined();
	});
	it("is withheld for a remote conversation, kept for a local one", () => {
		const { capabilities } = frame({
			skill_invocation: { available: true },
			stt: { available: true, path: "x" },
		});
		expect(sessionCapabilities(capabilities, false).skill_invocation).toEqual({
			available: true,
		});
		expect(
			sessionCapabilities(capabilities, true).skill_invocation,
		).toBeUndefined();
	});
});

describe("GET /api/skills rows", () => {
	it("parses name, description and hidden, in the order served", () => {
		const parsed = parsePayload("skills", {
			skills: [
				{ name: "b", description: "second", hidden: true },
				{ name: "a", description: "first", hidden: false },
			],
		});
		expect(parsed.skills.map((row) => row.name)).toEqual(["b", "a"]);
		expect(parsed.skills[0]?.hidden).toBe(true);
	});
	it("reads an omitted `hidden` as not hidden, and refuses an empty name", () => {
		expect(
			parsePayload("skills", { skills: [{ name: "a", description: "" }] })
				.skills[0]?.hidden,
		).toBe(false);
		expect(() =>
			parsePayload("skills", { skills: [{ name: "", description: "" }] }),
		).toThrow();
	});
});

describe("the command ack's skills block", () => {
	it("is optional and read when present", () => {
		expect(parsePayload("commandAck", { ok: true, detail: "d" })).toEqual({
			ok: true,
			detail: "d",
		});
		expect(
			parsePayload("commandAck", {
				ok: true,
				detail: "d",
				skills: { attached: ["a"], skipped: ["b"] },
			}).skills,
		).toEqual({ attached: ["a"], skipped: ["b"] });
	});
});

describe("the prompt/steer body", () => {
	const base = {
		command_id: "00000000-0000-0000-0000-000000000000",
		text: "x",
	};
	it("accepts expand_skills on both ops", () => {
		for (const op of ["prompt", "steer"] as const) {
			const parsed = parsePayload("commandOp", {
				op,
				...base,
				expand_skills: true,
			}) as { expand_skills?: boolean };
			expect(parsed.expand_skills).toBe(true);
		}
	});
});

describe("RelayEndpoints.skills", () => {
	it("asks for ONE session's catalogue with the id encoded in the query", async () => {
		const { RelayEndpoints } = await import("@/relay/endpoints");
		const calls: Array<{ schema: string; path: string; method: string }> = [];
		const endpoints = new RelayEndpoints({
			json: async (
				schema: string,
				request: { path: string; method: string },
			) => {
				calls.push({ schema, path: request.path, method: request.method });
				return { skills: [] };
			},
		} as never);
		await endpoints.skills("a b&c");
		expect(calls).toEqual([
			{
				schema: "skills",
				path: "/api/skills?session_id=a+b%26c",
				method: "GET",
			},
		]);
	});
});
