import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
	acknowledgedCurrentDraft,
	attachmentLabel,
	COMPOSER_COPY,
	composerControls,
	receiptForError,
} from "@/features/session/composer";
import {
	HEALTH_COPY,
	HEALTH_RESUME_COPY,
} from "@/features/session/health-copy";
import { RelayError } from "@/relay";

/**
 * The composer's state machine and its two error-taxonomy decisions.
 *
 * Everything here is a rule that a screen cannot state and a reviewer cannot see:
 * which command one control sends, why it is disabled, and whether an
 * acknowledgement is allowed to clear the draft in front of the reader.
 */

describe("the send/steer morph", () => {
	it("keeps one control in one place through every state", () => {
		const base = {
			hasDraft: true,
			hasImages: false,
			sending: false,
			envelopePending: false,
			ended: false,
		};
		const idle = composerControls({ ...base, streaming: false });
		const live = composerControls({ ...base, streaming: true });

		// The COMMAND changes and the label changes; nothing about the geometry does,
		// which is why the width is pinned at the render site.
		expect(idle.primary.op).toBe("prompt");
		expect(live.primary.op).toBe("steer");
		expect(idle.primary.kind).toBe("send");
		expect(live.primary.kind).toBe("steer");
		// Stop exists exactly while a turn runs.
		expect(idle.stopVisible).toBe(false);
		expect(live.stopVisible).toBe(true);
	});

	it("disables an empty draft and says nothing about it, because nothing is wrong", () => {
		const empty = composerControls({
			streaming: false,
			hasDraft: false,
			hasImages: false,
			sending: false,
			envelopePending: false,
			ended: false,
		});
		expect(empty.primary.disabled).toBe(true);
		expect(empty.disabledReason).toBeNull();
	});

	it("treats an attachment as content, so a caption-less image can be sent", () => {
		const imageOnly = composerControls({
			streaming: false,
			hasDraft: false,
			hasImages: true,
			sending: false,
			envelopePending: false,
			ended: false,
		});
		expect(imageOnly.primary.disabled).toBe(false);
	});

	it("blocks the primary while an instruction's delivery is unknown, and names why", () => {
		const blocked = composerControls({
			streaming: false,
			hasDraft: true,
			hasImages: false,
			sending: false,
			envelopePending: true,
			ended: false,
		});
		// A second, differently keyed instruction sent while the first may already be
		// admitted is the duplicate the envelope exists to prevent.
		expect(blocked.primary.disabled).toBe(true);
		expect(blocked.disabledReason).toBe(COMPOSER_COPY.retryDisabledHint);
	});

	it("reads `…` while sending, so the reader is told the control is busy", () => {
		const sending = composerControls({
			streaming: false,
			hasDraft: true,
			hasImages: false,
			sending: true,
			envelopePending: false,
			ended: false,
		});
		expect(sending.primary.label).toBe("…");
		// The face is the glyph in every non-sending state; the op is in the
		// accessible label, which is what a screen reader and Maestro both read.
		expect(
			composerControls({
				streaming: true,
				hasDraft: true,
				hasImages: false,
				sending: false,
				envelopePending: false,
				ended: false,
			}).primary.accessibilityLabel,
		).toBe("Steer the running turn");
		expect(sending.sending).toBe(true);
	});

	it("keeps the primary ENABLED on an ended session, because a send reopens it", () => {
		const ended = composerControls({
			streaming: false,
			hasDraft: true,
			hasImages: true,
			sending: false,
			envelopePending: false,
			ended: true,
		});
		// A send to an ended session is itself resume-then-send (the daemon wakes a
		// host for a prompt with no live entry), so the primary is the way back —
		// disabling it would refuse the one action that revives the session. The
		// placeholder, not a disabled reason, says what a send does.
		expect(ended.primary.disabled).toBe(false);
		expect(ended.disabledReason).toBeNull();
	});

	it("an ended session with an unresolved instruction still blocks on the instruction, without a third sentence", () => {
		// Both can be true at once. The retained instruction is the thing that
		// blocks a second send (the duplicate hazard), so the primary stays
		// disabled. But on an ended session the retained card already carries the
		// ended sentence and the one Retry; "Resolve the earlier instruction first"
		// under it was the third stacked message UX U7 / design D5 measured.
		const both = composerControls({
			streaming: false,
			hasDraft: true,
			hasImages: false,
			sending: false,
			envelopePending: true,
			ended: true,
		});
		expect(both.primary.disabled).toBe(true);
		expect(both.disabledReason).toBeNull();
		// A live session keeps the hint: there it is the only sentence that says
		// why the primary is dead.
		expect(
			composerControls({
				streaming: false,
				hasDraft: true,
				hasImages: false,
				sending: false,
				envelopePending: true,
				ended: false,
			}).disabledReason,
		).toBe(COMPOSER_COPY.retryDisabledHint);
	});
});

describe("an acknowledgement clears the draft only when it IS the draft", () => {
	it("clears when the acknowledged bytes are what the reader sees", () => {
		expect(
			acknowledgedCurrentDraft(
				{ text: "run the tests" },
				{ text: "run the tests" },
			),
		).toBe(true);
	});

	it("keeps an edit made while the request was in flight", () => {
		// The ack proves the OLD instruction was delivered and says nothing about the
		// text now on screen; clearing it would discard work the reader never sent.
		expect(
			acknowledgedCurrentDraft(
				{ text: "run the tests" },
				{ text: "run the tests and the linter" },
			),
		).toBe(false);
	});

	it("treats a different attachment set as a different instruction", () => {
		const image = { data_b64: "AAAA", mime_type: "image/png" };
		expect(
			acknowledgedCurrentDraft(
				{ text: "look", images: [image] },
				{ text: "look", images: [] },
			),
		).toBe(false);
		// Order is part of the identity: the wire carries a list.
		expect(
			acknowledgedCurrentDraft(
				{
					text: "look",
					images: [image, { data_b64: "BBBB", mime_type: "image/png" }],
				},
				{
					text: "look",
					images: [{ data_b64: "BBBB", mime_type: "image/png" }, image],
				},
			),
		).toBe(false);
	});
});

describe("the error taxonomy the reader sees", () => {
	const ambiguous = () =>
		new RelayError("transport", "the request did not reach the relay");
	const rejected = () =>
		new RelayError("rejected", "no such session", {
			status: 404,
			serverError: "no such session",
			envelope: "clear",
		});
	const expired = () =>
		new RelayError("radiant-login-required", "401", {
			status: 401,
			detail: "Your Radient session expired.",
			envelope: "clear-all",
		});

	it("classifies by the envelope directive the error layer already resolved", () => {
		expect(receiptForError(ambiguous()).kind).toBe("ambiguous");
		expect(receiptForError(rejected()).kind).toBe("rejected");
		expect(receiptForError(expired()).kind).toBe("sign-out");
	});

	it("renders the gateway's own sentence rather than inventing one", () => {
		const refusal = new RelayError("gateway-refused", "503", {
			status: 503,
			detail: "The connector is not authorized for this tunnel.",
			reason: "tunnel_not_authorized",
		});
		expect(receiptForError(refusal).message).toBe(
			"The connector is not authorized for this tunnel.",
		);
	});

	it("never shows a raw runtime string when the class forbids copy", () => {
		// A transport failure's own `message` is the fetch layer's prose, and it was a
		// shipped first impression ("Load failed", U3). The product's sentence is what a
		// reader gets instead.
		const bare = new RelayError("transport", "Load failed");
		// A transport error has no `detail`, so the class falls back to the product's
		// own words — which is the point: `String(exception)` must not reach a screen.
		expect(receiptForError(bare).message).not.toBe("Load failed");
		expect([
			COMPOSER_COPY.continuationError,
			COMPOSER_COPY.steerError,
		]).toContain(receiptForError(bare).message);
	});
});

describe("attachment metadata shown before send", () => {
	it("reports the DECODED size, not the base64 length", () => {
		// 4 base64 characters are 3 bytes, so a label built from the encoded length is
		// a third too large — a number the reader would compare against a file size.
		const image = { data_b64: "A".repeat(4096), mime_type: "image/png" };
		expect(attachmentLabel(image)).toBe("PNG · 3 KB");
	});

	it("floors a sub-kilobyte size instead of rounding it to zero", () => {
		// D58-2: the 70-byte fixture chip read `PNG · 0 KB` beside a visible image,
		// which reads as a broken or empty attachment. Anything under 1 KB says so.
		const image = { data_b64: "A".repeat(96), mime_type: "image/png" };
		expect(attachmentLabel(image)).toBe("PNG · < 1 KB");
	});
});

describe("the composer's ended copy has ONE source", () => {
	/* Review round 3, M2 / QA Q12 / UX U14 / design D12: this file's module used
	 * to hold literal copies of three catalogue sentences, and the copies were what
	 * rendered. `check-strings` cannot see that shape — it treats an exact mirror of
	 * a catalogue value as a deliberate one, and it scans only `-copy.ts` modules —
	 * so the binding is asserted here instead. Reading the catalogue makes
	 * divergence impossible; this test fails if a future edit re-inlines a literal. */
	const source = readFileSync(
		new URL("./composer.ts", import.meta.url),
		"utf8",
	);
	it("reads the placeholder, the failure sentence and the reopening line from the catalogue", () => {
		expect(COMPOSER_COPY.endedPlaceholder).toBe(
			HEALTH_COPY["relay.health.ended_placeholder"],
		);
		expect(COMPOSER_COPY.endedSendFailed).toBe(
			HEALTH_COPY["relay.health.ended_send_failed"],
		);
		expect(COMPOSER_COPY.reopening).toBe(HEALTH_RESUME_COPY.reopening);
	});
	it("carries none of those sentences as a literal", () => {
		for (const sentence of [
			HEALTH_COPY["relay.health.ended_placeholder"],
			HEALTH_COPY["relay.health.ended_send_failed"],
			HEALTH_RESUME_COPY.reopening,
		])
			expect(source).not.toContain(sentence);
	});
});
