import { describe, expect, it } from "vitest";

import type { ModelEntry } from "@/contracts";
import {
	foldersFailure,
	foldersFrom,
	homeModelReading,
	homeStartSelection,
	isAuthFailure,
	selectionSuperseded,
} from "@/features/home/home-defaults";
import { RelayError } from "@/relay/errors";

/**
 * The two decisions that live behind the home's chips, asserted on the BODY and on
 * the reading — the two places the shipped defects actually were.
 *
 * Neither defect was visible in a screenshot: the start body named a model the
 * reader never chose (so the computer overrode its own configured default) and it
 * named `home` where the computer had a better answer. So the assertions here are
 * about what `POST /api/sessions/start` receives and about which state the chip is
 * told, not about how a screen looks.
 */

const model = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
	selector: "anthropic/claude-opus-5",
	provider: "anthropic",
	model_id: "claude-opus-5",
	name: "Opus 5",
	...overrides,
});

const payload = (overrides: Record<string, unknown> = {}) =>
	({
		home: "/Users/reader",
		recent: ["/Users/reader/src/local-operator", "/Users/reader/notes"],
		tmp: "/tmp",
		default: "/Users/reader/src/local-operator",
		...overrides,
	}) as unknown as Parameters<typeof foldersFrom>[0];

describe("the start body the home builds", () => {
	it("names no model when the reader chose none", () => {
		// THE DEFECT. The app took the catalogue's first entry as "the default
		// model" and put it in every start body; the computer only applies its
		// configured default when the field is ABSENT, so the operator's Opus was
		// silently replaced by whichever entry sorted first.
		const body = homeStartSelection({
			cwd: "/Users/reader/src/local-operator",
			chosenModel: null,
		});
		expect(body).toStrictEqual({ cwd: "/Users/reader/src/local-operator" });
		expect(body).not.toHaveProperty("provider");
		expect(body).not.toHaveProperty("model_id");
	});

	it("carries the model the reader did choose", () => {
		expect(
			homeStartSelection({ cwd: "/tmp", chosenModel: model() }),
		).toStrictEqual({
			cwd: "/tmp",
			provider: "anthropic",
			model_id: "claude-opus-5",
		});
	});

	it("has no body at all until a folder is known", () => {
		// Guessing a directory is how the folder defect started; with nothing named
		// there is nothing to send, and the composer says so rather than starting
		// a session somewhere the reader never picked.
		expect(homeStartSelection({ cwd: null, chosenModel: null })).toBeNull();
		expect(homeStartSelection({ cwd: null, chosenModel: model() })).toBeNull();
	});
});

describe("the folders the computer publishes", () => {
	it("starts in the computer's default rather than in home", () => {
		// The second defect: the app read only `home` and started every first send
		// there, disagreeing with what the computer itself would have chosen.
		expect(foldersFrom(payload())).toStrictEqual({
			home: "/Users/reader",
			default: "/Users/reader/src/local-operator",
			recent: ["/Users/reader/src/local-operator", "/Users/reader/notes"],
		});
	});

	it("falls back to home only when the computer publishes no default", () => {
		// An older computer omits `default`; home is the one path its spawn gate
		// always admits, so it is the fallback rather than a guess.
		expect(foldersFrom(payload({ default: undefined })).default).toBe(
			"/Users/reader",
		);
		expect(foldersFrom(payload({ default: "   " })).default).toBe(
			"/Users/reader",
		);
	});

	it("keeps the failure's KIND instead of discarding it", () => {
		const refusal = new RelayError(
			"relay-unauthorized",
			"authentication required",
		);
		expect(foldersFailure(refusal)).toBe(refusal);
		expect(foldersFailure(refusal)?.kind).toBe("relay-unauthorized");
		// A throw that is not a RelayError keeps no kind — it is never dressed as one.
		expect(foldersFailure(new Error("boom"))).toBeNull();
		expect(foldersFailure("boom")).toBeNull();
	});

	it("counts exactly the credential kinds as auth failures", () => {
		expect(
			isAuthFailure(
				new RelayError("relay-unauthorized", "authentication required"),
			),
		).toBe(true);
		expect(
			isAuthFailure(new RelayError("radiant-login-required", "sign in again")),
		).toBe(true);
		expect(isAuthFailure(new RelayError("transport", "network down"))).toBe(
			false,
		);
		expect(isAuthFailure(null)).toBe(false);
	});
});

describe("what the model chip is told", () => {
	it("prefers the reader's own choice over everything the read says", () => {
		expect(
			homeModelReading({ chosenModel: model(), catalogue: "ready" }),
		).toStrictEqual({ kind: "selector", selector: "anthropic/claude-opus-5" });
		// A read still in flight, or one that failed, cannot un-know a choice.
		expect(
			homeModelReading({ chosenModel: model(), catalogue: "loading" }),
		).toStrictEqual({ kind: "selector", selector: "anthropic/claude-opus-5" });
		expect(
			homeModelReading({ chosenModel: model(), catalogue: "failed" }),
		).toStrictEqual({ kind: "selector", selector: "anthropic/claude-opus-5" });
	});

	it("says the default is in effect when the catalogue is readable and nothing is chosen", () => {
		// Not the catalogue's first row: nothing in the catalogue is "the default",
		// and naming one made an unchosen model read as chosen.
		expect(
			homeModelReading({ chosenModel: null, catalogue: "ready" }),
		).toStrictEqual({ kind: "default" });
	});

	it("reports the catalogue as unread when its read failed", () => {
		expect(
			homeModelReading({ chosenModel: null, catalogue: "failed" }),
		).toStrictEqual({ kind: "unknown" });
	});

	it("waits while the catalogue is still loading", () => {
		expect(
			homeModelReading({ chosenModel: null, catalogue: "loading" }),
		).toStrictEqual({ kind: "loading" });
	});
});

describe("a selection the record holds that the reader did not make", () => {
	it("is superseded, so the invented model cannot survive the fix", () => {
		// A record written by the previous build names the model it invented; the
		// home's own selection is what the reader's live choices produce.
		expect(
			selectionSuperseded(
				{
					cwd: "/Users/reader",
					provider: "anthropic",
					model_id: "claude-haiku-5-5",
				},
				{ cwd: "/Users/reader" },
			),
		).toBe(true);
	});

	it("is left alone when the record already agrees", () => {
		expect(
			selectionSuperseded({ cwd: "/Users/reader" }, { cwd: "/Users/reader" }),
		).toBe(false);
		expect(selectionSuperseded(null, { cwd: "/Users/reader" })).toBe(true);
	});
});
