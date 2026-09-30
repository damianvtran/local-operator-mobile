import { describe, expect, it } from "vitest";

import { COMPOSER_COPY } from "@/features/session/composer";
import { sendSlashCommand } from "@/features/session/send-slash";
import { slashQuery } from "@/features/session/slash";

/**
 * The tap path's SEND, at the seam that carries the draft.
 *
 * This is the part of the Q1 defect the first fix did not cover: the request was
 * right, but the tap called the client directly — so nothing set the in-flight
 * flag (a double tap sent twice), a throw became an unhandled rejection with no
 * surface, and the draft kept the command, which on this screen also kept the
 * sheet open over the row it had just run. The hook that used to hide all of this
 * cannot be loaded by the test runner (react-native's Flow source is not
 * parseable), which is why the send lives in a plain module with injected effects
 * and is tested here.
 */

const recordingEffects = () => {
	const calls: { sending: boolean }[] = [];
	const errors: (string | null)[] = [];
	const drafts: string[] = [];
	return {
		calls,
		errors,
		drafts,
		effects: {
			setSending: (sending: boolean) => calls.push({ sending }),
			setError: (message: string | null) => errors.push(message),
			setDraft: (draft: string) => drafts.push(draft),
		},
	};
};

/** A relay that answers `commandAck` — the shape `endpoints.command` resolves to,
 *  so the fake cannot be more permissive than the real client. */
const client = (fail?: unknown) => {
	const sent: { sessionId: string; body: unknown }[] = [];
	return {
		sent,
		command: async (sessionId: string, body: unknown) => {
			sent.push({ sessionId, body });
			if (fail !== undefined) throw fail;
			return { ok: true as const, detail: "command accepted" };
		},
	};
};

const request = { command: "help", args: "" };

describe("a tapped slash command is sent like any other send", () => {
	it("puts the whole command on the wire", async () => {
		const relay = client();
		const e = recordingEffects();
		await sendSlashCommand({
			client: relay,
			sessionId: "s1",
			request,
			effects: e.effects,
		});
		expect(relay.sent).toEqual([
			{ sessionId: "s1", body: { op: "slash", command: "help", args: "" } },
		]);
	});

	it("is disabled while the request is open, and released after it", async () => {
		// The double-tap case: the flag has to be ON before the await resolves,
		// because that is the window a second tap arrives in.
		const e = recordingEffects();
		let sendingWhileOpen: boolean | null = null;
		const relay = {
			command: async () => {
				sendingWhileOpen = e.calls.at(-1)?.sending ?? null;
				return { ok: true as const, detail: "command accepted" };
			},
		};
		await sendSlashCommand({
			client: relay,
			sessionId: "s1",
			request,
			effects: e.effects,
		});
		expect(sendingWhileOpen).toBe(true);
		expect(e.calls).toEqual([{ sending: true }, { sending: false }]);
	});

	it("clears the draft on success — which is what closes the sheet", async () => {
		const e = recordingEffects();
		await sendSlashCommand({
			client: client(),
			sessionId: "s1",
			request,
			effects: e.effects,
		});
		expect(e.drafts).toEqual([""]);
		// The link made explicit rather than assumed: the sheet's visibility IS
		// `slashQuery(draft) !== null`, so a cleared draft is a closed sheet.
		expect(slashQuery("")).toBeNull();
		expect(slashQuery("/help")).toBe("help");
	});

	it("releases the caller's synchronous guard on every exit", async () => {
		// The composer's ref, not its state: if this were not released, the composer
		// would latch shut after one failed command — the failure mode the guard
		// exists to prevent, inverted.
		for (const fail of [undefined, new Error("refused")]) {
			let released = 0;
			const e = recordingEffects();
			await sendSlashCommand({
				client: client(fail),
				sessionId: "s1",
				request,
				effects: {
					...e.effects,
					released: () => {
						released += 1;
					},
				},
			});
			expect(released).toBe(1);
		}
	});

	it("surfaces a refusal, and keeps the draft so the sheet stays open to retry it", async () => {
		const e = recordingEffects();
		// A plain Error, not a RelayError: the case the composer's own copy covers.
		const refused = new Error("not a relay error");
		const sent = await sendSlashCommand({
			client: client(refused),
			sessionId: "s1",
			request,
			effects: e.effects,
		});
		expect(sent).toBe(false);
		// A plain Error is not a RelayError: the product's own sentence, never
		// `String(exception)` — the rule the typed path applies.
		expect(e.errors).toEqual([null, COMPOSER_COPY.continuationError]);
		// No draft write at all, so the field — and the sheet with it — is untouched.
		expect(e.drafts).toEqual([]);
		// And the flag is released on the failure path too, or the composer would
		// latch disabled after one refusal.
		expect(e.calls).toEqual([{ sending: true }, { sending: false }]);
	});
});
