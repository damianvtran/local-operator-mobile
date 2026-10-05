// biome-ignore-all lint/style/noNonNullAssertion: an assertion after the case is
// constructed is the guard; a longhand local would obscure the rule being tested.
/**
 * The dictation rules: the draft join and the provenance behind the silent
 * annotation.
 *
 * These mirror the web reference's `lib/dictation.ts` semantics, which the design
 * names as authoritative — an append never clobbers, one separator only when it is
 * missing, and the annotation distinguishes typed / dictated / mixed with the
 * returned `path` (never an empty string).
 */

import { describe, expect, it } from "vitest";

import {
	annotationForSend,
	applyEdit,
	computeEdit,
	type DictationProvenance,
	emptyProvenance,
	formatDuration,
	joinDraft,
	noteDictation,
	resetOnEmptyDraft,
} from "@/stt/dictation";

describe("joinDraft", () => {
	it("returns the cleaned transcript when the base is empty", () => {
		expect(joinDraft("", "  hello world  ")).toBe("hello world");
		expect(joinDraft("   ", "\nhello")).toBe("hello");
	});

	it("adds exactly one separator, never a clobber", () => {
		expect(joinDraft("hello", "world")).toBe("hello world");
		expect(joinDraft("hello ", "world")).toBe("hello world");
		expect(joinDraft("hello\n", "world")).toBe("hello\nworld");
	});

	it("keeps the existing draft byte-for-byte", () => {
		expect(joinDraft("keep  me", "and me")).toBe("keep  me and me");
	});

	it("leaves the draft untouched for an empty transcript", () => {
		expect(joinDraft("hello", "")).toBe("hello");
		expect(joinDraft("hello", "   \n ")).toBe("hello");
	});
});

describe("provenance", () => {
	it("classifies a purely typed window as typed, with no path", () => {
		let provenance = emptyProvenance();
		provenance = applyEdit(provenance, computeEdit("", "typed")!);
		const annotation = annotationForSend(provenance);
		expect(annotation.input_mode).toBe(
			"typed",
		); /* Absence, never an empty string — the legacy reading, and a `""` would be
		 * a malformed present value the relay refuses (422). */
		expect("input_path" in annotation).toBe(false);
	});

	it("carries the returned path on a purely dictated window", () => {
		const provenance = noteDictation(emptyProvenance(), {
			start: 0,
			end: 5,
			path: "provider_stt_radient",
		});
		expect(annotationForSend(provenance)).toEqual({
			input_mode: "dictated",
			input_path: "provider_stt_radient",
		});
	});

	it("omits the path — never an empty string — when the response returned none", () => {
		const provenance = noteDictation(emptyProvenance(), {
			start: 0,
			end: 5,
			path: "",
		});
		const annotation = annotationForSend(provenance);
		expect(annotation.input_mode).toBe("dictated");
		expect("input_path" in annotation).toBe(false);
	});

	it("reports mixed when the window saw both typing and a dictation", () => {
		let provenance = noteDictation(emptyProvenance(), {
			start: 0,
			end: 5,
			path: "provider_stt_openai",
		});
		provenance = applyEdit(provenance, computeEdit("hello", "hello!")!);
		expect(annotationForSend(provenance)).toEqual({
			input_mode: "mixed",
			input_path: "provider_stt_openai",
		});
	});

	it("keeps the mode sticky and the last path on the deletion edge", () => {
		let provenance = noteDictation(emptyProvenance(), {
			start: 0,
			end: 5,
			path: "provider_stt_radient",
		});
		/* Delete the whole transcript: the span is trimmed out, but the deletion is
		 * itself an EDIT, so the sticky window has now seen typing too — the mode is
		 * `mixed`, and the path falls back to the last one recorded so the annotation
		 * never names a span the draft no longer holds. */
		provenance = applyEdit(provenance, computeEdit("hello", "")!);
		expect(provenance.sawDictation).toBe(true);
		expect(provenance.spans).toHaveLength(0);
		expect(annotationForSend(provenance)).toEqual({
			input_mode: "mixed",
			input_path: "provider_stt_radient",
		});
	});

	it("resets the window on an empty draft only", () => {
		const provenance: DictationProvenance = noteDictation(emptyProvenance(), {
			start: 0,
			end: 5,
			path: "provider_stt_radient",
		});
		expect(resetOnEmptyDraft(provenance, "still typing")).toBe(provenance);
		expect(resetOnEmptyDraft(provenance, "   ")).toEqual(emptyProvenance());
		expect(resetOnEmptyDraft(provenance, "")).toEqual(emptyProvenance());
	});

	it("shifts a span strictly after an edit, keeping its path", () => {
		const provenance = noteDictation(emptyProvenance(), {
			start: 4,
			end: 9,
			path: "provider_stt_radient",
		});
		// Insert "X" at position 0 → the span shifts right by one.
		const edited = applyEdit(provenance, {
			start: 0,
			endOld: 0,
			endNew: 1,
		});
		expect(edited.spans[0]).toEqual({
			start: 5,
			end: 10,
			path: "provider_stt_radient",
		});
	});
});

describe("formatDuration", () => {
	it("renders m:ss with a padded second", () => {
		expect(formatDuration(0)).toBe("0:00");
		expect(formatDuration(9)).toBe("0:09");
		expect(formatDuration(120)).toBe("2:00");
		expect(formatDuration(-3)).toBe("0:00");
	});
});
