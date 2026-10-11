import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	acceptFrameMessage,
	beatFromWire,
	beatLive,
	COPY_CANCELLED,
	COPY_FAILED,
	COPY_PREPARING,
	COPY_SHOW_FEWER,
	clampedHeightHint,
	clampFrameHeight,
	countClause,
	displayText,
	ERROR_MSG_MAX_CHARS,
	FRAME_GROUND_MARKER,
	fileRowParts,
	filesSummaryEntries,
	filesSummaryLine,
	filesSummaryOf,
	frameBudgetPx,
	HEIGHT_HINT_MAX,
	HEIGHT_HINT_MIN,
	MORE_MAX,
	moreText,
	NATIVE_SHIM_MARKER,
	NONCE_MAX_CHARS,
	nativeSupplementDocument,
	planComponentMounts,
	type SupplementBeat,
	type SupplementComponent,
	showAllText,
	sourceLine,
	supplementDisposition,
	supplementFileClass,
	supplementFrameUrl,
	supplementGroundDocument,
	supplementsFromWire,
	supplementThemeFor,
	THEME_VARIABLE_NAMES,
	WATCHDOG_MS,
} from "./supplements";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = join(root, "fixtures", "supplements");

/** The ground rule's own marker style, stripped whole in the byte-identity
 *  assertion below (top-level so the literal is not re-created per call). */
const GROUND_STYLE = /<style data-lo-frame-ground>[\s\S]*?<\/style>/;

/**
 * The mapping module against the SHARED fixtures, not a mock of my own.
 *
 * `fixtures/supplements/**` are byte-exact copies of the C0 contract fixtures
 * from `local-operator` (see that directory's README) — the same files the
 * TUI, UI and relay-web lanes assert against. The disposition matrix in
 * particular is the cross-surface contract: if this module and the fixture
 * disagree about one row, one of the four surfaces is painting the wrong thing.
 *
 * They sit OUTSIDE `fixtures/relay/**` deliberately: that corpus's rules (a
 * `provenance` marker in every JSON, kind implied by the directory) describe
 * relay SAMPLES, and these are another repo's generated contract artifacts
 * whose byte fidelity is the point — the directory README is their provenance.
 */

/** The durable row fixture, whose `payload.details` IS the beat's wire shape. */
const details = (name: string): Record<string, unknown> => {
	const row = JSON.parse(
		readFileSync(join(fixtures, "rows", `${name}.json`), "utf8"),
	) as { payload: { details: Record<string, unknown> } };
	return row.payload.details;
};

const beat = (name: string): SupplementBeat => {
	const parsed = beatFromWire(details(name));
	if (parsed === null) throw new Error(`fixture ${name} did not parse`);
	return parsed;
};

const rowNames = (): string[] =>
	readdirSync(join(fixtures, "rows"))
		.filter((file) => file.endsWith(".json") && file !== "dispositions.json")
		.map((file) => file.replace(/\.json$/, ""));

const dispositions = JSON.parse(
	readFileSync(join(fixtures, "rows", "dispositions.json"), "utf8"),
) as Record<string, { live: string; cold: string }>;

const messages = JSON.parse(
	readFileSync(join(fixtures, "messages", "messages.json"), "utf8"),
) as {
	host: Record<string, unknown>;
	frame_accepted: Record<string, Record<string, unknown>>;
	frame_rejected: Record<string, Record<string, unknown>>;
	nonce_boundary: {
		max_chars: number;
		accepted: { nonce: string; message: Record<string, unknown> };
		rejected: { nonce: string; message: Record<string, unknown> };
	};
};

const documentHtml = readFileSync(
	join(fixtures, "documents", "populated.html"),
	"utf8",
);

describe("the wire reader", () => {
	it("parses every row fixture into a beat whose anchor and state match", () => {
		for (const name of rowNames()) {
			const parsed = beatFromWire(details(name));
			expect(parsed, name).not.toBeNull();
			expect(parsed?.anchor).toBe(details(name).anchor);
			expect(parsed?.state).toBe(details(name).state);
		}
	});

	it("reads the map keyed by anchor, dropping a malformed value", () => {
		const wire = {
			[String(details("done_populated").anchor)]: details("done_populated"),
			"another-anchor": { state: "done" }, // no anchor of its own
			"third-anchor": "not an object",
		};
		const map = supplementsFromWire(wire);
		expect(Object.keys(map)).toEqual([
			String(details("done_populated").anchor),
		]);
	});

	it("drops a beat whose state is not one of the eight frozen words", () => {
		expect(
			beatFromWire({ anchor: "a", state: "preparing", version: 1 }),
		).toBeNull();
		expect(beatFromWire({ anchor: "", state: "done" })).toBeNull();
		expect(supplementsFromWire(null)).toEqual({});
		expect(supplementsFromWire([])).toEqual({});
	});

	it("keeps the newest version for an anchor, and drops a key it disagrees with", () => {
		// The key IS the anchor on this wire (the daemon keys the map by the same
		// field the row carries). A wire where the two disagree is broken, and the
		// honest read is to drop it: rendering it under the KEY's row while the
		// ops would target the beat's own anchor is how a cancel lands on the
		// wrong job.
		const anchor = String(details("done_empty").anchor);
		const version1 = { ...details("done_empty"), version: 1 };
		const version2 = { ...details("done_populated"), version: 2 };
		const map = supplementsFromWire({
			[anchor]: version1,
			somewhere_else: version2,
		});
		expect(map[anchor]?.version).toBe(1);
		expect(map.somewhere_else).toBeUndefined();
	});
});

describe("the frozen reader rule, against the shared matrix", () => {
	it("agrees with dispositions.json for every row, live and cold", () => {
		for (const name of rowNames()) {
			const parsed = beat(name);
			expect(supplementDisposition(parsed, true), `${name} (live)`).toBe(
				dispositions[name]?.live,
			);
			expect(supplementDisposition(parsed, false), `${name} (cold)`).toBe(
				dispositions[name]?.cold,
			);
		}
	});

	it("is the stale-row rule: a queued row with no live job is cancelled, not spinning", () => {
		// The fixture the whole rule exists for.
		const stale = beat("queued_stale");
		expect(supplementDisposition(stale, false)).toBe(
			dispositions.queued_stale?.cold,
		);
		expect(supplementDisposition(stale, true)).toBe(
			dispositions.queued_stale?.live,
		);
	});

	it("says a superseded or dismissed row renders nothing whatever its state", () => {
		for (const name of ["superseded", "dismissed"]) {
			expect(supplementDisposition(beat(name), true), name).toBe("nothing");
			expect(supplementDisposition(beat(name), false), name).toBe("nothing");
		}
	});
});

describe("beatLive", () => {
	it("treats running and cancelling as live-only words", () => {
		for (const name of rowNames()) {
			const parsed = beat(name);
			const expected =
				parsed.state === "running" || parsed.state === "cancelling"
					? true
					: undefined;
			if (expected !== undefined) {
				expect(beatLive(parsed, 0), name).toBe(true);
			}
		}
	});

	it("reads a non-terminal row as live only when the projection has a process", () => {
		expect(beatLive(beat("queued_stale"), 0)).toBe(false);
		expect(beatLive(beat("queued_stale"), 4812)).toBe(true);
		// A terminal row's disposition IGNORES the pid — the property that keeps a
		// settled block from re-painting when the projection's identity changes.
		for (const name of ["done_populated", "failed", "cancelled"]) {
			expect(supplementDisposition(beat(name), true), name).toBe(
				supplementDisposition(beat(name), false),
			);
		}
	});
});

describe("the frame message wire, against the shared fixture", () => {
	const nonce = "n-4f2a9c1e07b3";

	it("accepts every frame_accepted shape", () => {
		for (const [name, message] of Object.entries(messages.frame_accepted)) {
			expect(acceptFrameMessage(message, nonce), name).not.toBeNull();
		}
	});

	it("refuses every frame_rejected shape", () => {
		for (const [name, message] of Object.entries(messages.frame_rejected)) {
			expect(acceptFrameMessage(message, nonce), name).toBeNull();
		}
	});

	it("holds the nonce boundary exactly", () => {
		const boundary = messages.nonce_boundary;
		expect(boundary.max_chars).toBe(NONCE_MAX_CHARS);
		expect(
			acceptFrameMessage(boundary.accepted.message, boundary.accepted.nonce),
		).not.toBeNull();
		expect(
			acceptFrameMessage(boundary.rejected.message, boundary.rejected.nonce),
		).toBeNull();
	});

	it("accepts `ready` without a nonce — it precedes the first theme push", () => {
		const ready = messages.frame_accepted.ready;
		expect(acceptFrameMessage(ready, null)).not.toBeNull();
	});

	it("caps an error's message at the contract's bound", () => {
		expect(
			acceptFrameMessage({ ...messages.frame_accepted.error }, nonce),
		).not.toBeNull();
		expect(
			acceptFrameMessage(
				{
					...messages.frame_accepted.error,
					msg: "x".repeat(ERROR_MSG_MAX_CHARS + 1),
				},
				nonce,
			),
		).toBeNull();
	});
});

describe("frame geometry", () => {
	const component = (heightHint: number): SupplementComponent => ({
		attachment: "04c2d29b140086cc637ad19ef34012c5",
		title: "t",
		source: "s",
		mime: "text/html",
		heightHint,
	});

	it("clamps a frame's height into the contract's range", () => {
		expect(clampFrameHeight(10)).toBe(HEIGHT_HINT_MIN);
		expect(clampFrameHeight(10000)).toBe(HEIGHT_HINT_MAX);
		expect(clampFrameHeight(300)).toBe(300);
	});

	it("bounds the block's budget to the smaller of 480 pt and 40 vh", () => {
		expect(frameBudgetPx(2000)).toBe(480);
		expect(frameBudgetPx(800)).toBe(320);
		expect(frameBudgetPx(0)).toBe(0);
	});

	it("admits the first frame regardless of budget and HOLDS at an unmeasured one", () => {
		const components = [component(300), component(300), component(300)];
		const { visible, hidden } = planComponentMounts(components, 100);
		// First always; the second cannot mount until the first has reported a
		// RENDERED height, whatever the budget says.
		expect(visible).toHaveLength(1);
		expect(hidden).toHaveLength(2);

		const measured = new Map([[components[0]?.attachment ?? "", 200]]);
		const withOne = planComponentMounts(components, 480, measured);
		expect(withOne.visible).toHaveLength(2);
		expect(withOne.hidden).toHaveLength(1);
	});

	it("clamps a provided hint the same way the reserved box does", () => {
		expect(clampedHeightHint(component(10))).toBe(HEIGHT_HINT_MIN);
		expect(clampedHeightHint(component(1000))).toBe(HEIGHT_HINT_MAX);
	});
});

describe("display copy and the paint boundary", () => {
	it("strips terminal control sequences and hidden characters from a name", () => {
		expect(displayText("\u001b[31mred\u001b[0m")).toBe("red");
		expect(displayText("left\u202eright")).toBe("leftright");
		expect(displayText("a\tb\nc")).toBe("a b c");
		expect(displayText("  spaced  ")).toBe("spaced");
		// A name is NOT a number: the trailing-`.0` rule belongs to
		// `fileSizeText` alone, and applying it here would rename a file called
		// `report-v4.0.md`.
		expect(displayText("report-v4.0.md")).toBe("report-v4.0.md");
		expect(displayText("4.25")).toBe("4.25");
		expect(displayText(null)).toBe("");
		expect(displayText(7)).toBe("");
	});

	it("states files, sizes and the two disclosures", () => {
		expect(filesSummaryLine(["a.md", "b.csv"])).toBe("2 files: a.md, b.csv");
		expect(filesSummaryLine(["a.md"])).toBe("1 file: a.md");
		// The one-liner's names: featured files then the stored tail, capped at two
		// — the caller only asks for it when the whole set has at most two.
		expect(filesSummaryOf(beat("done_files_only"))).toBe(
			"2 files: latency.md, bench.csv",
		);
		// The disclosures' open-state words: the relay web's and the desktop UI's
		// own constant, adopted rather than reinvented (UX round 1, R6).
		expect(COPY_SHOW_FEWER).toBe("Show fewer");
		// The one-liner's rows carry the file and its index where the route can
		// serve one — the affordance's data (U3) — and nothing where it cannot:
		// a stored tail name has neither, so its row stays inert text.
		const entries = filesSummaryEntries(beat("done_files_only"));
		expect(entries.map((entry) => entry.name)).toEqual([
			"latency.md",
			"bench.csv",
		]);
		expect(entries.map((entry) => entry.index)).toEqual([0, 1]);
		expect(entries.every((entry) => entry.file !== null)).toBe(true);
		const withTail = {
			...beat("done_files_only"),
			files: beat("done_files_only").files.slice(0, 1),
			filesMore: 1,
			more: ["docs/extra.pdf"],
		};
		expect(filesSummaryOf(withTail)).toBe("2 files: latency.md, extra.pdf");
		const tail = filesSummaryEntries(withTail);
		expect(tail[1]?.name).toBe("extra.pdf");
		expect(tail[1]?.index).toBeNull();
		expect(tail[1]?.file).toBeNull();
		expect(moreText(1)).toBe("1 more file");
		expect(moreText(2)).toBe("2 more files");
		expect(showAllText(1)).toBe("Show all 1 graphic");
		expect(showAllText(2)).toBe("Show all 2 graphics");
		expect(countClause(1, "graphic")).toBe("1 graphic");
		expect(countClause(3, "file")).toBe("3 files");
	});

	it("formats a size the way every surface does", () => {
		const file = beat("done_populated").files[0];
		if (file === undefined) throw new Error("fixture lost its files");
		const parts = fileRowParts(file);
		expect(parts.name).toBe("latency.md");
		// 4,120 bytes is 4.02 KB, and the one-decimal round says `4 KB` — the same
		// `4.1 KB / 1.2 MB` grammar the TUI's `file_size_text` prints.
		expect(parts.size).toBe("4 KB");
		const small = beat("done_files_only").files[1];
		if (small === undefined) throw new Error("fixture lost its files");
		expect(fileRowParts(small).size).toBe("913 B");
	});

	it("prints exactly one `Source: …` line per component", () => {
		expect(
			sourceLine("bench.csv rows 1-4 (tool result of bash at 10:41)"),
		).toBe("Source: bench.csv rows 1-4 (tool result of bash at 10:41)");
		// The caption is display-stripped like every other host-rendered string.
		expect(sourceLine("a\u001b[0mb")).toBe("Source: ab");
	});

	it("takes the preview affordance from the suffix the file route resolves", () => {
		expect(supplementFileClass("latency.md")).toBe("text");
		expect(supplementFileClass("bench.CSV")).toBe("text");
		expect(supplementFileClass("chart.png")).toBe("image");
		expect(supplementFileClass("spec.pdf")).toBe("pdf");
		expect(supplementFileClass("no-extension")).toBe("other");
		expect(supplementFileClass("plot.svg")).toBe("other");
	});
});

describe("the theme channel", () => {
	it("carries every variable the prelude consumes, in both modes", () => {
		for (const mode of ["light", "dark"] as const) {
			const theme = supplementThemeFor(mode);
			expect(theme.mode).toBe(mode);
			for (const name of THEME_VARIABLE_NAMES) {
				expect(theme.vars[name], `${mode} ${name}`).toMatch(/^#|rgb|,/);
			}
		}
		// The two modes must actually differ — a mapping that returned the light
		// palette twice would pass every assertion above.
		expect(supplementThemeFor("dark").vars["--lo-canvas"]).not.toBe(
			supplementThemeFor("light").vars["--lo-canvas"],
		);
	});
});

describe("the native shim", () => {
	it("injects exactly one listener, after <head>, leaving the document otherwise byte-identical", () => {
		const injected = nativeSupplementDocument(documentHtml);
		expect(injected).not.toBe(documentHtml);
		expect(injected).toContain(NATIVE_SHIM_MARKER);
		expect(injected.indexOf(NATIVE_SHIM_MARKER)).toBeGreaterThan(
			injected.indexOf("<head>"),
		);
		// Removing the injected script returns the ORIGINAL bytes: the shim must
		// never touch the served document beyond its own insertion.
		const stripped = injected.replace(
			/<script data-lo-native-shim>[\s\S]*?<\/script>/,
			"",
		);
		expect(stripped).toBe(documentHtml);
	});

	it("is idempotent: a second mount of the same bytes adds nothing", () => {
		const once = nativeSupplementDocument(documentHtml);
		expect(nativeSupplementDocument(once)).toBe(once);
	});

	it("leaves the document's own CSP in force", () => {
		const injected = nativeSupplementDocument(documentHtml);
		expect(injected).toContain("Content-Security-Policy");
		expect(injected).toContain("default-src 'none'");
		expect(injected).toContain("script-src 'unsafe-inline'");
	});

	it("forwards only contract-tagged posts and grants the frame nothing", () => {
		const injected = nativeSupplementDocument(documentHtml);
		// The tag check is the shim's whole outbound gate.
		expect(injected).toContain('d.lo!=="supplement"');
		// It reaches for the library's own channel and nothing else.
		expect(injected).toContain("window.ReactNativeWebView");
		expect(injected).not.toContain("injectedJavaScript");
	});

	it("refuses a document it does not recognise", () => {
		expect(nativeSupplementDocument("plain text")).toBe("plain text");
	});
});

describe("the frame ground rule", () => {
	it("injects its style after <head>, leaving the document otherwise byte-identical", () => {
		const injected = supplementGroundDocument(documentHtml);
		expect(injected).not.toBe(documentHtml);
		expect(injected).toContain(FRAME_GROUND_MARKER);
		expect(injected).toContain("html{background:var(--lo-canvas)}");
		expect(injected.indexOf(FRAME_GROUND_MARKER)).toBeGreaterThan(
			injected.indexOf("<head>"),
		);
		// Removing the injected style returns the ORIGINAL bytes: the rule must
		// never touch the served document beyond its own insertion.
		const stripped = injected.replace(GROUND_STYLE, "");
		expect(stripped).toBe(documentHtml);
	});

	it("is idempotent: a second mount of the same bytes adds nothing", () => {
		const once = supplementGroundDocument(documentHtml);
		expect(supplementGroundDocument(once)).toBe(once);
	});

	it("refuses a document it does not recognise", () => {
		expect(supplementGroundDocument("plain text")).toBe("plain text");
	});

	it("composes with the native shim without disturbing either", () => {
		const mounted = nativeSupplementDocument(
			supplementGroundDocument(documentHtml),
		);
		expect(mounted).toContain(FRAME_GROUND_MARKER);
		expect(mounted).toContain(NATIVE_SHIM_MARKER);
		// The document's own CSP and prelude are untouched.
		expect(mounted).toContain("connect-src 'none'");
		expect(mounted).toContain("--lo-canvas");
	});
});

describe("the web mount URL", () => {
	it("round-trips the document's bytes, UTF-8 and all", () => {
		const html = documentHtml.slice(0, 500) + "✓ … — \u{1F4CA}";
		const url = supplementFrameUrl(html);
		expect(url.startsWith("data:text/html;base64,")).toBe(true);
		const base64 = url.slice("data:text/html;base64,".length);
		const bytes = Buffer.from(base64, "base64");
		expect(new TextDecoder().decode(bytes)).toBe(html);
	});
});

describe("the copy table", () => {
	it("keeps the four sentences the surfaces share, byte for byte", () => {
		// These strings are asserted against the TUI's constants by the DESIGN
		// review of every surface; pinning them here is what makes a copy edit a
		// failing test rather than four surfaces drifting apart.
		expect(COPY_PREPARING).toBe("Preparing highlights…");
		expect(COPY_CANCELLED).toBe("Highlights cancelled");
		expect(COPY_FAILED).toBe("Couldn't prepare highlights");
		expect(WATCHDOG_MS).toBe(5000);
		expect(MORE_MAX).toBe(20);
	});
});
