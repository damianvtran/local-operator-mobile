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
 * The freeze LANDED (harness-lane, 2026-10-09): the LIVE DETAIL tests now pin
 * the canonical field names (`stage`, `queue_position`, `progress_fraction`,
 * `log_lines`, `error`, `error_type`) — a PRESENT case, an ABSENT case and a
 * stated-but-unreadable case for every field, the three shapes a live feed
 * actually produces — and the STAGE tests pin the five values, the stated
 * `null` failure, and the fallback for everything else.
 */

/**
 * A minimal valid tool row; the `generate_image` shape the wire will carry.
 *
 * `details` takes a plain bag and widens through the same cast the adapter
 * reads with: the wire's `details` is a LOOSE bag (`looseObject` in
 * `schemas.ts`) while the generated mirror type is closed, so a fixture that
 * writes the canonical live-detail keys passes them through — exactly the
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
	] as const)(
		"falls back to tool_state %s (no stage) as %s",
		(state, phase) => {
			expect(imageGenView(row({ tool_state: state }))?.phase).toBe(phase);
		},
	);

	it.each([
		["queued", "queued"],
		["in_progress", "running"],
		["completed", "done"],
		["cancelled", "cancelled"],
		["cancelling", "cancelling"],
	] as const)("maps a present stage %s to %s", (stage, phase) => {
		expect(imageGenView(row({ details: { stage } }))?.phase).toBe(phase);
	});

	it("maps the stated `null` stage to failed — the mid-walk failure", () => {
		const view = imageGenView(
			row({
				tool_state: "running",
				details: {
					stage: null,
					error: "FAL (flux-schnell) exceeded its 120s generation budget.",
					error_type: "timeout",
				},
			}),
		);
		expect(view?.phase).toBe("failed");
		expect(view?.live.error).toBe(
			"FAL (flux-schnell) exceeded its 120s generation budget.",
		);
	});

	it("lets a present stage beat the tool_state fallback, and falls back on an unknown one", () => {
		/* The feed's stage is the finer truth; an unknown value is not a state
		 * this build knows — it reads as absent and the reduced fallback renders
		 * instead of a guess. */
		expect(
			imageGenView(
				row({ tool_state: "queued", details: { stage: "in_progress" } }),
			)?.phase,
		).toBe("running");
		expect(
			imageGenView(
				row({ tool_state: "running", details: { stage: "future-stage" } }),
			)?.phase,
		).toBe("running");
	});

	it("reads a terminal `completed` on a settled record to the done-arm", () => {
		/* The live completion update does not reach the transcript today, but the
		 * vocabulary value is documented (harness-lane freeze) and a settled
		 * receipt carrying it must render the done-arm: the artifact through the
		 * existing image path, no live treatment (the card's live guard is pinned
		 * against `done` in `imagegen-card.test.ts`). Stray live fields on the
		 * settled record change nothing. */
		const view = imageGenView(
			row({
				tool_state: "done",
				images: [{ index: 0, mime_type: "image/png" }],
				details: {
					stage: "completed",
					log_lines: [
						{
							message: "IN_PROGRESS — upscaling",
							timestamp: "2026-10-09T01:02:31Z",
						},
					],
					progress_fraction: 0.9,
				},
			}),
		);
		expect(view?.phase).toBe("done");
		expect(view?.artifact).toEqual({ index: 0, mimeType: "image/png" });
		expect(view?.cancelable).toBe(false);
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
	it("reads the canonical fields as sent", () => {
		const live = imageGenLiveDetail(
			row({
				details: {
					stage: "in_progress",
					queue_position: 3,
					progress_fraction: 0.42,
					log_lines: [
						{ message: "IN_QUEUE", timestamp: "2026-10-09T00:00:00Z" },
						{ message: "IN_PROGRESS", timestamp: "2026-10-09T00:00:02Z" },
					],
				},
			}),
		);
		expect(live.stage).toBe("in_progress");
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

	it("keeps a log array to its message lines, verbatim", () => {
		const live = imageGenLiveDetail(
			row({
				details: {
					log_lines: [
						{ message: "first", timestamp: "t1" },
						{ timestamp: "t2" },
						{ message: 7 },
						"second",
						{ message: "third" },
					],
				},
			}),
		);
		/* Entries without a string `message` are DROPPED rather than stringified:
		 * a `7` was never a log line, and rendering "7" would be this client
		 * writing the machine's script for it. */
		expect(live.logs).toEqual(["first", "third"]);
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
		["a string fraction", { progress_fraction: "0.5" }, "progress"],
		["a fraction above one", { progress_fraction: 1.5 }, "progress"],
		["a negative fraction", { progress_fraction: -0.01 }, "progress"],
		["NaN", { progress_fraction: Number.NaN }, "progress"],
		["log_lines that are not an array", { log_lines: "IN_PROGRESS" }, "logs"],
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
		expect(
			imageGenLiveDetail(row({ details: { progress_fraction: 0 } })).progress,
		).toBe(0);
		expect(
			imageGenLiveDetail(row({ details: { progress_fraction: 1 } })).progress,
		).toBe(1);
		expect(
			imageGenLiveDetail(row({ details: { queue_position: 0 } })).queuePosition,
		).toBe(0);
	});

	it("reads the five canonical stages", () => {
		for (const stage of [
			"queued",
			"in_progress",
			"completed",
			"cancelled",
			"cancelling",
		] as const) {
			expect(imageGenLiveDetail(row({ details: { stage } })).stage).toBe(stage);
		}
	});

	it("reads an explicit `stage: null` as the failure the contract says it is", () => {
		expect(
			imageGenLiveDetail(row({ details: { stage: null } })).stage,
		).toBeNull();
	});

	it("reads an unknown stage as absent, so the fallback renders instead", () => {
		/* A future vocabulary value must not crash or mispaint: it reads as
		 * absent and the tool_state fallback draws the reduced state. */
		expect(
			imageGenLiveDetail(row({ details: { stage: "downloading" } })).stage,
		).toBeUndefined();
		expect(
			imageGenLiveDetail(row({ details: { stage: 3 } })).stage,
		).toBeUndefined();
	});

	it("reads everything as absent from an empty details bag", () => {
		const live = imageGenLiveDetail(row({}));
		expect(live).toEqual({
			stage: undefined,
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
	/* Harness-lane freeze (2026-10-09): a cancel that races a job which already
	 * finished answers a CONFLICT with `error_type: media_already_completed` +
	 * the platform's own sentence, and the frozen rule is that no surface paints
	 * it as an error. The card's half of that rule is this derivation — "Already
	 * finished", quiet tone, no failure sentence. */
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

	it("marks the canonical cancelled fold of the same conflict", () => {
		/* The producer's final row carries `stage: "cancelled"` + the pair; the
		 * tool_state fold may read failed — BOTH folds must render "Already
		 * finished", and this is the shape the freeze landed. */
		const view = imageGenView(
			row({
				tool_state: "failed",
				details: {
					stage: "cancelled",
					error:
						"The generation had already completed when the cancel arrived; its result was discarded.",
					error_type: "media_already_completed",
				},
			}),
		);
		expect(view?.phase).toBe("cancelled");
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

	it("is false for any LIVE or done row, even when the row carries the code", () => {
		/* The code is a CONFLICT's, and a conflict is a settled row: on a done,
		 * queued or running row it is not the reading this client is entitled to
		 * make. The settled fallback (`interrupted`) does read it — that is the
		 * same conflict fold the fallback exists for. */
		for (const state of ["queued", "running", "done"] as const) {
			expect(
				imageGenView(
					row({
						tool_state: state,
						details: { error_type: "media_already_completed" },
					}),
				)?.alreadyFinished,
			).toBe(false);
		}
		expect(
			imageGenView(
				row({
					tool_state: "interrupted",
					details: { error_type: "media_already_completed" },
				}),
			)?.alreadyFinished,
		).toBe(true);
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

	it("produces `cancelling` only from the wire's own stage", () => {
		/* The tool_state fallback never produces it. The canonical stage carries
		 * it (the cancel-confirmation hold), and the card's local overlay covers
		 * the window before the feed's first update — the two draw one word. */
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
		expect(
			imageGenView(
				row({ tool_state: "running", details: { stage: "cancelling" } }),
			)?.phase,
		).toBe("cancelling");
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
