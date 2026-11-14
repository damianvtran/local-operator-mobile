import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { owedPendingEchoes } from "@/features/session/pending-echo";
import type { ContinuationEnvelope } from "@/relay/retry-envelope";
import { startupEchoes } from "./startup-echoes";

/* TestFlight 906: a first send's message must be on screen from admission, not
 * after `POST /api/sessions/start` and the first stream frame. These pin how the
 * coordinator's facts become rows, and that the failure semantics stay the
 * coordinator's: every phase maps to an honest caption, none to a lie. */

const envelope = (
	id: string,
	text: string,
	images?: ContinuationEnvelope["images"],
): ContinuationEnvelope => ({
	op: "prompt",
	command_id: id,
	text,
	...(images ? { images } : {}),
});
const IMAGE = { data_b64: "iVBORw0KGgo=", mime_type: "image/png" };

describe("startupEchoes", () => {
	it("paints a queued first message, text AND images, as a live sending row", () => {
		const rows = startupEchoes({
			phase: "starting",
			queue: [envelope("c1", "hello", [IMAGE])],
			delivered: [],
		});
		expect(rows).toEqual([
			{
				commandId: "c1",
				text: "hello",
				imageCount: 1,
				images: [IMAGE],
				op: "prompt",
				accepted: false,
			},
		]);
	});

	it("marks a delivered message accepted and shows it once while it is in both lists", () => {
		const rows = startupEchoes({
			phase: "ready",
			queue: [envelope("c1", "hello"), envelope("c2", "next")],
			delivered: [envelope("c1", "hello")],
		});
		expect(rows.map((row) => [row.commandId, row.accepted])).toEqual([
			["c1", true],
			["c2", false],
		]);
	});

	it.each([
		["refused", "refused"],
		["unconfirmed", "unconfirmed"],
		["blocked", "unconfirmed"],
	] as const)(
		"captions a %s start as a %s row, never as sending",
		(phase, failure) => {
			const [row] = startupEchoes({
				phase,
				queue: [envelope("c1", "hello")],
				delivered: [],
			});
			expect(row?.failure).toBe(failure);
			expect(row?.accepted).toBe(false);
		},
	);

	it("an empty (auth-replaced) snapshot paints nothing", () => {
		expect(startupEchoes({ phase: "draft", queue: [], delivered: [] })).toEqual(
			[],
		);
	});

	it("hands a row over to the transcript entry with the same id, never both", () => {
		const rows = startupEchoes({
			phase: "ready",
			queue: [],
			delivered: [envelope("c1", "hello")],
		});
		const entry = { id: "c1", kind: "user" } as TranscriptEntry;
		expect(owedPendingEchoes(rows, [])).toHaveLength(1);
		expect(owedPendingEchoes(rows, [entry])).toEqual([]);
	});
});
