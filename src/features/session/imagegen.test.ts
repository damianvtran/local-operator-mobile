import { describe, expect, it } from "vitest";

import type { TranscriptEntry, TranscriptEntryDetails } from "@/contracts";
import {
	IMAGEGEN_ALREADY_FINISHED_TONE,
	IMAGEGEN_STATE_WORD,
	IMAGEGEN_TONE,
	IMAGEGEN_TOOLS,
	imageGenCancelOverlay,
	imageGenCardPhase,
	imageGenLiveDetail,
	imageGenLivePhase,
	imageGenStateLine,
	imageGenView,
	isImageGenTool,
} from "@/features/session/imagegen";

/**
 * The image-gen surface's own vocabulary: detection, the one adapter, and the
 * absence paths.
 *
 * The coverage is deliberately shaped around the freeze: the LIVE DETAIL tests
 * are the contract this lane will have to re-pin when the harness lane freezes
 * the field names, so every field has a PRESENT case, an ABSENT case, and a
 * stated-but-unreadable case — the three shapes a live feed actually produces.
 * Everything else (phases, copy, gating) is the surface's own vocabulary and
 * should not need to move at the freeze at all.
 */

/**
 * A minimal valid tool row; the `generate_image` shape the wire will carry.
 *
 * `details` takes a plain bag and widens through the same cast the adapter
 * reads with: the wire's `details` is a LOOSE bag (`looseObject` in
 * `schemas.ts`) while the generated mirror type is closed, so a fixture that
 * writes the provisional live-detail keys passes them through — exactly the
 * direction the boundary is built for — rather than this lane widening a type
 * it does not own.
 */
const row = (
	overrides: Omit<Partial<TranscriptEntry>, "details"> & {
		details?: Record<string, unknown>;
	} = {},
): TranscriptEntry => {
	const { details, ...rest } = overrides;
	return {
		id: "tc-img-1",
		kind: "tool",
		text: "",
		tool_call_id: "call-1",
		tool_name: "generate_image",
		tool_state: "running",
		summary: "a lighthouse at dusk",
		intent: "",
		diff_added: 0,
		diff_removed: 0,
		elapsed_s: 0,
		error: "",
		images: [],
		final: false,
		text_complete: false,
		...rest,
		details: (details ?? {}) as unknown as TranscriptEntryDetails,
	};
};

describe("the detection set", () => {
	it("names exactly the one frozen tool", () => {
		/* Harness-lane update (2026-10-08): ONE tool — image-to-image is a
		 * `source_image_path` parameter on `generate_image`, not a second name.
		 * A new member here is a deliberate change, which is why this asserts the
		 * whole set rather than membership. */
		expect([...IMAGEGEN_TOOLS]).toEqual(["generate_image"]);
	});

	it("detects the tool whatever casing the wire sends", () => {
		expect(isImageGenTool(row({ tool_name: "generate_image" }))).toBe(true);
		expect(isImageGenTool(row({ tool_name: "Generate_Image" }))).toBe(true);
		expect(isImageGenTool(row({ tool_name: "GENERATE_IMAGE" }))).toBe(true);
	});

	it.each([
		["another tool", "bash"],
		["the absent edit sibling", "generate_altered_image"],
		["a name that merely contains the tool", "generate_image_v2"],
		["an empty name", ""],
	])("does not detect %s", (_case, name) => {
		expect(isImageGenTool(row({ tool_name: name }))).toBe(false);
	});
});

describe("imageGenView", () => {
	it("returns null outside the detection set, so the row falls through", () => {
		expect(imageGenView(row({ tool_name: "bash" }))).toBeNull();
	});

	it.each([
		["composing", "queued"],
		["queued", "queued"],
		["running", "running"],
		["done", "done"],
		["failed", "failed"],
		["interrupted", "cancelled"],
	] as const)("maps tool_state %s to %s", (state, phase) => {
		expect(imageGenView(row({ tool_state: state }))?.phase).toBe(phase);
	});

	it("carries the tool's name and summary through verbatim", () => {
		const view = imageGenView(
			row({ summary: "a wide shot, golden hour", tool_state: "queued" }),
		);
		expect(view?.tool).toBe("generate_image");
		expect(view?.summary).toBe("a wide shot, golden hour");
	});

	it("reports the elapsed time only once the wire has measured one", () => {
		/* The `toolElapsed` rule, reused rather than restated: `0` is "not
		 * measured yet", not "took no time". */
		expect(imageGenView(row({ elapsed_s: 0 }))?.elapsed).toBeNull();
		expect(imageGenView(row({ elapsed_s: 12.3 }))?.elapsed).toBe("12s");
		expect(imageGenView(row({ elapsed_s: 75 }))?.elapsed).toBe("1m 15s");
	});
});

describe("the live detail (the one place the field names live)", () => {
	it("reads queue_position, progress and logs as sent", () => {
		const live = imageGenLiveDetail(
			row({
				details: {
					queue_position: 3,
					progress: 0.42,
					logs: ["IN_QUEUE", "IN_PROGRESS"],
				},
			}),
		);
		expect(live.queuePosition).toBe(3);
		expect(live.progress).toBe(0.42);
		expect(live.logs).toEqual(["IN_QUEUE", "IN_PROGRESS"]);
		expect(live.error).toBeNull();
		expect(live.errorType).toBeNull();
	});

	it("reads the platform's error sentence and its structured code", () => {
		/* The frozen shape (harness-lane, 2026-10-08): `error` is the platform's
		 * stable sentence — never FAL free-text — and `error_type` the structured
		 * code beside it. */
		const live = imageGenLiveDetail(
			row({
				error: "This generation failed before producing output.",
				details: { error_type: "media_failed" },
			}),
		);
		expect(live.error).toBe("This generation failed before producing output.");
		expect(live.errorType).toBe("media_failed");
	});

	it("keeps a log array to its string lines, verbatim", () => {
		const live = imageGenLiveDetail(
			row({ details: { logs: ["first", 7, null, "second"] } }),
		);
		/* Non-strings are DROPPED rather than stringified: a `7` was never a log
		 * line, and rendering "7" would be this client writing the machine's
		 * script for it. */
		expect(live.logs).toEqual(["first", "second"]);
	});

	it("reads the provider's error from the entry, falling back to details", () => {
		expect(
			imageGenLiveDetail(row({ error: "FAL: job failed in IN_PROGRESS" }))
				.error,
		).toBe("FAL: job failed in IN_PROGRESS");
		expect(
			imageGenLiveDetail(row({ details: { error: "queue timeout" } })).error,
		).toBe("queue timeout");
		/* The entry's own field wins when both are present: it is the one every
		 * other surface already reads. */
		expect(
			imageGenLiveDetail(
				row({ error: "entry text", details: { error: "detail text" } }),
			).error,
		).toBe("entry text");
	});

	it.each([
		[
			"a string where the queue position belongs",
			{ queue_position: "3" },
			"queuePosition",
		],
		["a fractional queue position", { queue_position: 3.5 }, "queuePosition"],
		["a negative queue position", { queue_position: -1 }, "queuePosition"],
		["a string progress", { progress: "0.5" }, "progress"],
		["a fraction above one", { progress: 1.5 }, "progress"],
		["a negative fraction", { progress: -0.01 }, "progress"],
		["NaN", { progress: Number.NaN }, "progress"],
		["logs that are not an array", { logs: "IN_PROGRESS" }, "logs"],
		["a non-string error", { error: 500 }, "error"],
		["a non-string error_type", { error_type: 7 }, "errorType"],
	])("reads %s as absent", (_case, details, field) => {
		const live = imageGenLiveDetail(row({ details }));
		if (field === "logs") {
			expect(live.logs).toEqual([]);
			return;
		}
		expect(
			live[field as "queuePosition" | "progress" | "error" | "errorType"],
		).toBeNull();
	});

	it("reads the boundary fractions as present", () => {
		/* 0 and 1 are real states — "barely started" and "done bar-wise" — and
		 * the falsy trap is exactly how a `0` gets rendered as "no progress". */
		expect(imageGenLiveDetail(row({ details: { progress: 0 } })).progress).toBe(
			0,
		);
		expect(imageGenLiveDetail(row({ details: { progress: 1 } })).progress).toBe(
			1,
		);
		expect(
			imageGenLiveDetail(row({ details: { queue_position: 0 } })).queuePosition,
		).toBe(0);
	});

	it("reads everything as absent from an empty details bag", () => {
		const live = imageGenLiveDetail(row({}));
		expect(live).toEqual({
			queuePosition: null,
			progress: null,
			logs: [],
			error: null,
			errorType: null,
		});
	});
});

describe("the artifact", () => {
	it("is the row's first image, indexed like every other image block", () => {
		const view = imageGenView(
			row({
				tool_state: "done",
				images: [{ index: 0, mime_type: "image/png" }],
			}),
		);
		expect(view?.artifact).toEqual({ index: 0, mimeType: "image/png" });
	});

	it.each(["queued", "running", "failed", "interrupted"] as const)(
		"is withheld while the call is %s, even with an image reference on the row",
		(state) => {
			/* A running row carrying a reference must not render bytes the call has
			 * not produced — the attachment contract indexes artifacts like images,
			 * and only a done row's artifact IS the result. */
			const view = imageGenView(
				row({
					tool_state: state,
					images: [{ index: 0, mime_type: "image/png" }],
				}),
			);
			expect(view?.artifact).toBeNull();
		},
	);

	it("is null when a done row carries no image at all", () => {
		/* The pre-attachment feed: done, no block. The reduced state renders. */
		expect(imageGenView(row({ tool_state: "done" }))?.artifact).toBeNull();
	});
});

describe("cancel gating", () => {
	it.each([
		["queued", true],
		["running", true],
		["done", false],
		["failed", false],
		["interrupted", false],
	] as const)("is %s -> cancelable %s", (state, cancelable) => {
		expect(imageGenView(row({ tool_state: state }))?.cancelable).toBe(
			cancelable,
		);
	});

	/* The overlay's two directions are the review round 1 F2 finding: it must
	 * hold over a request that WAS delivered (the confirmation has not landed),
	 * and it must DROP over one that was not (nothing is in flight, and the
	 * composer's error line carries the failure). A regression to the latching
	 * behaviour is a red test here, not a code read. */
	it("keeps the overlay when the request was delivered", () => {
		expect(imageGenCancelOverlay(true, "request-delivered")).toBe(true);
	});

	it("clears the overlay when the request never reached the relay", () => {
		expect(imageGenCancelOverlay(true, "request-failed")).toBe(false);
	});

	it("raises the overlay on the press and retires it on settle", () => {
		expect(imageGenCancelOverlay(false, "press")).toBe(true);
		expect(imageGenCancelOverlay(true, "settled")).toBe(false);
	});

	it("draws `cancelling` only over a live phase that was requested", () => {
		expect(imageGenCardPhase("running", true)).toBe("cancelling");
		expect(imageGenCardPhase("queued", true)).toBe("cancelling");
		// A settled phase is never overlaid, even if the flag has not cleared yet.
		expect(imageGenCardPhase("done", true)).toBe("done");
		expect(imageGenCardPhase("failed", true)).toBe("failed");
		expect(imageGenCardPhase("running", false)).toBe("running");
	});

	it("keeps `cancelable` and `live phase` one definition", () => {
		for (const state of [
			"queued",
			"running",
			"done",
			"failed",
			"interrupted",
		] as const) {
			const view = imageGenView(row({ tool_state: state }));
			if (view === null) throw new Error(`no view for ${state}`);
			expect(imageGenLivePhase(view.phase)).toBe(view.cancelable);
		}
	});
});

describe("the already-finished conflict", () => {
	/* Harness-lane freeze (2026-10-08): a cancel that races a job which already
	 * finished answers a CONFLICT with `error_type: media_already_completed`,
	 * and the frozen rule is that no surface paints it as an error. The card's
	 * half of that rule is this derivation — "Already finished", quiet tone,
	 * no failure sentence. */
	it("marks a failed row whose code is the conflict", () => {
		const view = imageGenView(
			row({
				tool_state: "failed",
				error: "the generation had already finished",
				details: { error_type: "media_already_completed" },
			}),
		);
		expect(view?.alreadyFinished).toBe(true);
	});

	it.each([
		["a real failure", "media_failed"],
		["a platform rate limit", "media_rate_limited"],
		["a vendor code", "content_policy_violation"],
	])("is false for %s", (_case, errorType) => {
		const view = imageGenView(
			row({
				tool_state: "failed",
				details: { error_type: errorType },
			}),
		);
		expect(view?.alreadyFinished).toBe(false);
	});

	it("is false for any phase other than failed, even when the row carries the code", () => {
		/* The code is a CONFLICT's; on a done or running row it is not the
		 * reading this client is entitled to make. */
		for (const state of ["queued", "running", "done", "interrupted"] as const) {
			expect(
				imageGenView(
					row({
						tool_state: state,
						details: { error_type: "media_already_completed" },
					}),
				)?.alreadyFinished,
			).toBe(false);
		}
	});
});

describe("the copy and the tone tables", () => {
	it("gives every card phase a word and a tone", () => {
		/* Typed as `Record<ImageGenCardPhase, …>`, so the compiler already holds
		 * this; the runtime assertion is for the table's CONTENT being non-empty,
		 * the failure a spread or a merge would actually produce. */
		for (const phase of [
			"queued",
			"running",
			"cancelling",
			"done",
			"failed",
			"cancelled",
		] as const) {
			expect(IMAGEGEN_STATE_WORD[phase].length).toBeGreaterThan(0);
			expect(IMAGEGEN_TONE[phase].glyph.length).toBeGreaterThan(0);
			expect(IMAGEGEN_TONE[phase].inkClass.startsWith("text-")).toBe(true);
		}
	});

	it("uses the tool row's own glyphs, so the family reads as one", () => {
		expect(IMAGEGEN_TONE.queued.glyph).toBe("⋯");
		expect(IMAGEGEN_TONE.running.glyph).toBe("⟳");
		expect(IMAGEGEN_TONE.done.glyph).toBe("✓");
		expect(IMAGEGEN_TONE.failed.glyph).toBe("✗");
		/* `–`/warning for the aborted call, exactly as `toolGlyph` reads
		 * `interrupted` — an interrupted tool is a state the reader must notice. */
		expect(IMAGEGEN_TONE.cancelled).toEqual({
			glyph: "–",
			inkClass: "text-warning",
		});
	});

	it("does not let a running row claim a cancellation in progress", () => {
		/* `cancelling` is NOT produced by the adapter at all: it is the component's
		 * local overlay on a live phase, applied after the press and until the
		 * entry settles. A view that could say `cancelling` on its own would be a
		 * state the wire never stated. */
		for (const state of [
			"queued",
			"running",
			"done",
			"failed",
			"interrupted",
		] as const) {
			expect(imageGenView(row({ tool_state: state }))?.phase).not.toBe(
				"cancelling",
			);
		}
	});

	it("composes the queued word with the position only when one arrived", () => {
		expect(
			imageGenStateLine("queued", {
				queuePosition: 3,
				hasArtifact: false,
				alreadyFinished: false,
			}),
		).toBe("Queued · position 3");
		expect(
			imageGenStateLine("queued", {
				queuePosition: null,
				hasArtifact: false,
				alreadyFinished: false,
			}),
		).toBe("Queued");
	});

	it("says 'Image ready' only when the artifact is actually there", () => {
		expect(
			imageGenStateLine("done", {
				queuePosition: null,
				hasArtifact: true,
				alreadyFinished: false,
			}),
		).toBe("Image ready");
		expect(
			imageGenStateLine("done", {
				queuePosition: null,
				hasArtifact: false,
				alreadyFinished: false,
			}),
		).toBe("Done");
	});

	it("says 'Already finished' for the conflict, 'Failed' for a failure", () => {
		expect(
			imageGenStateLine("failed", {
				queuePosition: null,
				hasArtifact: false,
				alreadyFinished: true,
			}),
		).toBe("Already finished");
		expect(
			imageGenStateLine("failed", {
				queuePosition: null,
				hasArtifact: false,
				alreadyFinished: false,
			}),
		).toBe("Failed");
	});

	it("gives the already-finished reading a quiet tone, never the danger one", () => {
		expect(IMAGEGEN_ALREADY_FINISHED_TONE.inkClass).not.toContain("danger");
		expect(IMAGEGEN_ALREADY_FINISHED_TONE.glyph).toBe("–");
	});

	it("names the cancelling phase as in-progress, not as an outcome", () => {
		expect(IMAGEGEN_STATE_WORD.cancelling).toBe("Cancelling…");
		expect(IMAGEGEN_STATE_WORD.cancelled).toBe("Cancelled");
	});
});
