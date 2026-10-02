import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CONTROL, EMPTY, isKnownIdentifier, SCREEN, SURFACE } from "@/ui/a11y";

/**
 * The identifier contract, checked from the outside in.
 *
 * `src/ui/a11y.ts` is the single source of truth for the names; the Maestro flows
 * (`e2e/maestro/**`) are YAML that must follow it, never the reverse. Two streams
 * once wrote two vocabularies with no overlap and every flow failed on its first
 * assertion, and nothing in the unit suite could notice, because each side was
 * internally consistent. This test reads the flows themselves.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const flowsDir = join(root, "e2e/maestro");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/**
 * Comments out of a source file before asking "is this identifier rendered".
 *
 * Without this the check is satisfied by a mention: proven on the last round's head,
 * where declaring an identifier and referring to it inside a `//` comment passed the
 * guard while nothing rendered it. A leading `*` also drops the JSDoc line, and block
 * comments are removed whole.
 */
const stripComments = (text: string): string =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\*.*$/gm, "")
		.replace(/\/\/.*$/gm, "");

/** `id: "x"` and `- id: x` selectors, quoted or not. Text selectors and regexes
 * are not identifiers and are deliberately not matched. */
const TESTID_LITERAL = /\btestID\s*[:=]\s*(?:"[^"]*"|\{\s*[`"']|["'`])/;
const YAML_FILE = /\.ya?ml$/;
/* `.ts` as well as `.tsx`: the session view keeps its connection banner's copy and
 *  its identifier map in `.ts` modules, so a `.tsx`-only scan reported every one of
 *  its ids as unrendered (measured on the other stream's branch: 18 of them). */
const SOURCE_FILE = /\.tsx?$/;
/* Tests carry identifiers too — in fixtures, in mocked props — and an id that only a
 *  test spells is not a rendered control, which is the whole point of the check. */
const EXCLUDED_FILE = /\.(?:test|e2e\.test)\.tsx?$/;
const ID_LINE = /^\s*(?:-\s*)?id:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/;

/**
 * A step the app cannot serve yet, marked in the flow rather than deleted.
 *
 * The marked id is one the app does not render — the screen that would own it is
 * named so review can see the gap. This marker is why a flow can land before the
 * screen does without the suite going quiet about it: the test below requires the
 * marked id to be genuinely unknown, so the marker can never be used to hide a
 * rename or to smuggle a real identifier past the check above.
 *
 * The header of every flow documents this spelling; `<the-identifier>` there is
 * prose, not a marker, which is why the pattern requires a concrete name.
 */
const BLOCKED_LINE = /^\s*#\s*BLOCKED:\s*needs\s+(\S+)\s+from\s+(\S+)/;

const referencedIds = (): Map<string, string[]> => {
	const byId = new Map<string, string[]>();
	for (const file of walk(flowsDir).filter((f) => YAML_FILE.test(f))) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const id = ID_LINE.exec(line)?.[1];
			if (id === undefined) continue;
			byId.set(id, [...(byId.get(id) ?? []), file.slice(root.length)]);
		}
	}
	return byId;
};

/**
 * The identifiers declared for stream D2's session view, whose renderers are not on
 * this branch.
 *
 * One list, one reason, and a condition for its removal: the commit that merges the
 * session view deletes these names from here, and until it does the count above makes
 * the exemption visible in every run rather than silent.
 */
const PENDING_SESSION_VIEW: ReadonlySet<string> = new Set([
	"CONTROL.composerSend",
	"CONTROL.composerStop",
	"CONTROL.composerAttach",
	"CONTROL.composerResume",
	"CONTROL.composerInput",
	"CONTROL.composerRetry",
	"CONTROL.composerModelChip",
	"CONTROL.composerEffortChip",
	"CONTROL.slashFilter",
	"CONTROL.pendingApprove",
	"CONTROL.pendingDeny",
	"CONTROL.pendingRemember",
	"CONTROL.pendingAskSubmit",
	"CONTROL.todosDisclosure",
	"CONTROL.subagentsDisclosure",
	"CONTROL.connectionRetry",
	"CONTROL.connectionSignIn",
	"CONTROL.connectionConsole",
	"CONTROL.codeBlockCopy",
	"SURFACE.sessionTranscript",
	"SURFACE.sessionComposer",
	"SURFACE.sessionColumn",
	"SURFACE.sessionContext",
	"SURFACE.sessionLoading",
	"SURFACE.sessionTranscriptEmpty",
	"SURFACE.sessionWorkingLine",
	"SURFACE.composerNotice",
	"SURFACE.composerError",
	"SURFACE.composerRetained",
	"SURFACE.composerReceipt",
	"SURFACE.composerDisabledReason",
	"SURFACE.queuedMessageChip",
	"SURFACE.connectionBanner",
	"SURFACE.connectionWaiting",
	"SURFACE.connectionClearsByItself",
	"SURFACE.connectionCertificateRejected",
	"SURFACE.connectionHostUnresolved",
	"SURFACE.connectionComputerOffline",
	"SURFACE.connectionMachineRemedy",
	"SURFACE.connectionRelayNotInstalled",
	"SURFACE.connectionTunnelUnavailable",
	"SURFACE.modelSheet",
	"SURFACE.effortSheet",
	"SURFACE.slashSheet",
	"SURFACE.todosPanel",
	"SURFACE.todosBody",
	"SURFACE.subagentsPanel",
	"SURFACE.subagentsBody",
	"SURFACE.subagentRunning",
	"SURFACE.pendingCardBody",
	"SURFACE.pendingCardDetail",
	"SURFACE.pendingCardDestructiveMarker",
	"SURFACE.pendingCardAnswer",
	"SURFACE.pendingCardError",
	"SURFACE.transcriptStreaming",
]);

describe("the Maestro flows against src/ui/a11y.ts", () => {
	// `e2e/` lands with the audit-harness stream. Until it is on this branch there
	// is nothing to read, and a fixture copy would only test the copy, so the check
	// arms itself the moment the directory exists instead of passing vacuously.
	it.skipIf(!existsSync(flowsDir))(
		"finds every id a flow references in the identifier set",
		() => {
			const referenced = referencedIds();
			expect(referenced.size).toBeGreaterThan(0);
			const unknown = [...referenced]
				.filter(([id]) => !isKnownIdentifier(id))
				.map(([id, files]) => `${id}  (${[...new Set(files)].join(", ")})`);
			expect(unknown, "ids in the flows that the app never renders").toEqual(
				[],
			);
		},
	);
});

describe("the rendered check reads code, not prose", () => {
	it("drops a mention that lives in a comment", () => {
		/* The failure this closes, reproduced on the last head: a declared identifier
		 *  with no renderer passed the check as soon as a scanned file mentioned it in a
		 *  comment, which is precisely the "selector no flow can ever hit" the check
		 *  exists to catch. */
		const source = [
			"// CONTROL.scratchProbeId is planned for a later pass",
			"/* CONTROL.otherProbe too */",
			" * CONTROL.jSDocProbe in a doc block",
			"const real = { testID: CONTROL.settingsBack };",
		].join("\n");
		const stripped = stripComments(source);
		expect(stripped).not.toContain("scratchProbeId");
		expect(stripped).not.toContain("otherProbe");
		expect(stripped).not.toContain("jSDocProbe");
		expect(stripped).toContain("CONTROL.settingsBack");
	});
});

/**
 * The markers a flow leaves where the app has no identifier yet.
 *
 * A marked id is a selector that cannot match today, so its value is that it is
 * *visible*: review reads the list, and the two assertions below keep it honest.
 */
/**
 * Whether a marker's `from <name>` names a screen this app declares.
 *
 * Both spellings are accepted because both read naturally in a comment: the
 * SCREEN key in kebab-case (`signIn` → `sign-in`) and the rendered value
 * (`sign-in-screen`). Anything else means the gap cannot be assigned to a screen,
 * which is the point of requiring the clause at all.
 */
const isScreenName = (name: string): boolean => {
	const keys = Object.keys(SCREEN);
	const kebab = (value: string): string =>
		value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
	return keys.some(
		(key) => kebab(key) === name || SCREEN[key as keyof typeof SCREEN] === name,
	);
};

const blockedMarkers = (): Array<{
	id: string;
	screen: string;
	file: string;
}> => {
	const out: Array<{ id: string; screen: string; file: string }> = [];
	for (const file of walk(flowsDir).filter((f) => YAML_FILE.test(f))) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const match = BLOCKED_LINE.exec(line);
			if (match === null) continue;
			out.push({
				id: match[1] ?? "",
				screen: match[2] ?? "",
				file: file.slice(root.length),
			});
		}
	}
	return out;
};

describe("the blocked steps the flows declare", () => {
	it.skipIf(!existsSync(flowsDir))(
		"marks only identifiers the app genuinely does not render",
		() => {
			const markers = blockedMarkers();
			// A marker naming something the app DOES render is either a stale
			// comment or an attempt to skip a real check; both are failures.
			const hidable = markers
				.filter(
					({ id, screen }) => id.startsWith("<") || screen.startsWith("<"),
				)
				.map(
					({ id, file }) => `${id}  (${file}) — the marker needs a concrete id`,
				);
			expect(hidable).toEqual([]);
			const alreadyRendered = markers
				.filter(({ id }) => isKnownIdentifier(id))
				.map(
					({ id, file }) =>
						`${id}  (${file}) — the app renders this; uncomment the step`,
				);
			expect(alreadyRendered).toEqual([]);
			// The owning screen has to be named, or the gap cannot be assigned.
			const unnamed = markers
				.filter(({ screen }) => !isScreenName(screen))
				.map(({ id, screen, file }) => `${id} → '${screen}'  (${file})`);
			expect(unnamed).toEqual([]);
		},
	);
});

describe("the routes and primitives against src/ui/a11y.ts", () => {
	const sources = [
		...walk(join(root, "app")),
		...walk(join(root, "src/ui")),
		/* `src/features/**` too: the screens a route renders live there, so a
		 *  scan of `app/**` alone would report every identifier as unused the
		 *  moment a route became a thin wrapper — which is what the wave-2
		 *  restructure did (measured: 63 "unreferenced" ids, all of them used). */
		...walk(join(root, "src/features")),
	]
		.filter((f) => SOURCE_FILE.test(f) && !EXCLUDED_FILE.test(f))
		.map((file) => ({
			file: file.slice(root.length),
			text: readFileSync(file, "utf8"),
		}));

	it("never types an identifier as a literal", () => {
		// A literal `testID="settings-theme"` is a second spelling waiting to
		// drift from the constant the flows are checked against. Spread and
		// caller-supplied values (`testID={testID}`) are fine; a string is not.
		const offenders = sources
			.filter(({ text }) => TESTID_LITERAL.test(text))
			.map(({ file }) => file);
		expect(offenders).toEqual([]);
	});

	it("references every declared identifier from at least one route or primitive", () => {
		// A declared-but-unrendered identifier is a selector no flow can ever hit,
		// and it would still satisfy the flow check above.
		const rendered = sources.map(({ text }) => stripComments(text)).join("\n");
		const unused = Object.entries({ SCREEN, EMPTY, CONTROL, SURFACE }).flatMap(
			([group, ids]) =>
				Object.keys(ids)
					.filter(
						(key) => !new RegExp(`\\b${group}\\.${key}\\b`).test(rendered),
					)
					.map((key) => `${group}.${key}`),
		);
		/* The session view's vocabulary is declared here, in the ONE contract, while
		 *  its renderers live on the other stream's branch — this branch carries no
		 *  `src/features/session/**` at all. The exemption is checked from BOTH sides,
		 *  which is what keeps it from becoming a dumping ground: a pending name must
		 *  be unrendered today, so the commit that renders one has to delete it from
		 *  this list, and the list is printed by name whenever the check runs. */
		const pending = unused.filter((name) => PENDING_SESSION_VIEW.has(name));
		const genuinelyUnused = unused.filter(
			(name) => !PENDING_SESSION_VIEW.has(name),
		);
		expect(genuinelyUnused).toEqual([]);
		expect(
			pending.length,
			`${pending.length} identifier(s) declared for the session view and not yet rendered on this branch: ${pending.join(", ")}`,
		).toBe(PENDING_SESSION_VIEW.size);
	});
});
