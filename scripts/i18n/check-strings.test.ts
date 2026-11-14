import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	type BaselineEntry,
	baselineGrowth,
	buildBaseline,
	migrationCandidates,
	ratchet,
	unaccountable,
	validateGrowth,
} from "./ratchet.ts";
import {
	EXPRESSION_LITERAL_SCOPE,
	expressionRuleActive,
	scanSource,
	scanTree,
} from "./scan-strings.ts";

/**
 * The scanner and the ratchet, on inputs small enough to read.
 *
 * A rule that fires on TypeScript generics or on a developer diagnostic would
 * make the baseline grow for reasons that have nothing to do with copy, and a
 * ratchet that can grow is not a ratchet. Both are asserted here.
 */
const ACCOUNTABLE = () => ({ owner: "o", payoff: "p" });
const FILE = "src/features/example/example.tsx";
const COPY_FILE = "src/features/example/example-copy.ts";

describe("the scanner", () => {
	it("finds prose in a JSX body", () => {
		const findings = scanSource(
			FILE,
			[
				"export const Screen = () => (",
				"\t<View>",
				"\t\t<Text>Connect a computer to send.</Text>",
				"\t</View>",
				");",
			].join("\n"),
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.rule).toBe("jsx-text");
		expect(findings[0]?.text).toBe("Connect a computer to send.");
	});

	it("finds prose on its own line under an opening tag", () => {
		const findings = scanSource(
			FILE,
			["<Text style={styles.title}>", "\tNothing is armed", "</Text>"].join(
				"\n",
			),
		);
		expect(findings.map((finding) => finding.text)).toContain(
			"Nothing is armed",
		);
	});

	it("does not fire on a keyed expression", () => {
		const findings = scanSource(
			FILE,
			[
				"<Text>",
				'\t{t("mobile.home.greeting")}',
				"</Text>",
				"<Text>{copy(`mobile.home.greeting`)}</Text>",
			].join("\n"),
		);
		expect(findings).toHaveLength(0);
	});

	it("does not fire on a comment", () => {
		const findings = scanSource(
			FILE,
			[
				"<View>",
				"\t// This comment explains the frame and mentions no copy.",
				"\t/* A block comment",
				"\t   with more words in it. */",
				"</View>",
			].join("\n"),
		);
		expect(findings).toHaveLength(0);
	});

	it("does not mistake TypeScript generics for JSX", () => {
		const findings = scanSource(
			"src/connection/client.ts",
			[
				"export type Fetch = (input: string) => Promise<Response>;",
				"const load = async (): Promise<Thing> => thing<Other>(x);",
			].join("\n"),
		);
		expect(findings).toHaveLength(0);
	});

	it("finds a user-facing attribute literal and ignores a test id", () => {
		const findings = scanSource(
			FILE,
			[
				'<Button accessibilityLabel="Use this computer" testID="use-computer" />',
				'<Input placeholder="Type a project name" />',
			].join("\n"),
		);
		expect(findings.map((finding) => finding.text)).toEqual([
			"Use this computer",
			"Type a project name",
		]);
		expect(findings.every((finding) => finding.rule === "jsx-attribute")).toBe(
			true,
		);
	});

	it("finds copy-bearing component props without treating identifiers as copy", () => {
		const props = [
			"headline",
			"next",
			"subtitle",
			"caption",
			"body",
			"message",
			"hint",
			"description",
			"detail",
		];
		const source = props
			.map((prop) => `<Card ${prop}="Visible human copy" />`)
			.join("\n");
		expect(scanSource(FILE, source).map((finding) => finding.text)).toEqual(
			props.map(() => "Visible human copy"),
		);
		expect(
			scanSource(FILE, '<Card testID="technical identifier value" />'),
		).toHaveLength(0);
	});

	it("finds a sentence added to a copy module", () => {
		const findings = scanSource(
			COPY_FILE,
			['export const NOTE = "Delete this project?";'].join("\n"),
		);
		expect(findings.map((finding) => finding.rule)).toEqual([
			"copy-module-literal",
		]);
	});

	it("leaves a developer diagnostic alone", () => {
		const findings = scanSource(
			COPY_FILE,
			[
				"if (!Object.hasOwn(table, key)) {",
				`\tthrow new RangeError(\`Missing source key: \${key}\`);`,
				"}",
			].join("\n"),
		);
		expect(findings).toHaveLength(0);
	});

	it("accepts a copy-module literal the catalogue already owns", () => {
		/* The mirror case: a module that cannot import the runtime keeps its table,
		 * and the catalogue owns the same sentence. Not an omission. */
		const source = 'export const NOTE = "Delete this project?";';
		expect(scanSource(COPY_FILE, source)).toHaveLength(1);
		expect(
			scanSource(COPY_FILE, source, new Set(["Delete this project?"])),
		).toHaveLength(0);
	});

	/* Rules 1-3 outside rule 4's activation scope: an in-word apostrophe in JSX
	 * prose used to open a single-quoted "literal" that never closed, so every
	 * finding below it vanished (own-tunnel-settings.tsx went blind after :196).
	 * ONE apostrophe on purpose: two would pair up and hide only the text
	 * between them, which understates the bug. */
	it("does not let a JSX-text apostrophe blind the rest of the file", () => {
		const findings = scanSource(
			FILE,
			[
				"<Text>Uses the platform's relay.</Text>",
				"<View>",
				"\t<Text>",
				"\t\tThe address is private",
				"\t</Text>",
				"</View>",
				"<Text>Read this later.</Text>",
				'<Button label="Copy the address" />',
			].join("\n"),
		);
		expect(findings.map((finding) => [finding.line, finding.text])).toEqual([
			[4, "The address is private"],
			[1, "Uses the platform's relay."],
			[7, "Read this later."],
			[8, "Copy the address"],
		]);
	});

	it("still finds literals after backticks in JSX text (guard)", () => {
		const findings = scanSource(
			FILE,
			[
				"<Text>Run `lop serve` on the computer.</Text>",
				"<Text>Then scan the code.</Text>",
			].join("\n"),
		);
		expect(findings.map((finding) => finding.text)).toContain(
			"Then scan the code.",
		);
	});

	it("keeps real quoted and template literals in code as literals", () => {
		const source = [
			"const mode = 'primary';",
			"const path = `/session/${id}`;",
			"<Text style={styles.x}>Plain body text</Text>",
			"<Input placeholder='Your name' />",
			"<Input placeholder={`Hello ${name}`} />",
		].join("\n");
		expect(
			scanSource(FILE, source).map((finding) => [
				finding.rule,
				finding.line,
				finding.text,
			]),
		).toEqual([
			["jsx-text", 3, "Plain body text"],
			["jsx-attribute", 4, "Your name"],
		]);
	});
});

/**
 * Rule 4 (`expression-literal`) is ACTIVATION-SCOPED: it fires only in the files
 * listed in `EXPRESSION_LITERAL_SCOPE`. Both directions are controls — an
 * unkeyed literal in an activated file must be found (and the ratchet must call
 * it added), and the same literal elsewhere must NOT be, because widening the
 * rule to the whole tree is a staged rollout that keys what it finds, never a
 * baseline dump.
 */
describe("the expression-literal rule", () => {
	const ACTIVATED = "src/features/settings/settings.tsx";
	const ELSEWHERE = "src/features/example/example.tsx";
	const APP = "app/(app)/session/[id]/video.tsx";
	const SOURCE = [
		'const a = ready ? "Not signed in with Radient" : "";',
		'const b = name ?? "Not signed in yet";',
		"function f(x: number) {",
		'\tif (x > 0) return "Nothing is connected";',
		"\treturn `Connected directly to ${x}`;",
		"}",
		"const c = ready",
		'\t? "First line"',
		'\t: "Second line";',
	].join("\n");

	it("finds literals in a conditional, a ?? fallback and function returns", () => {
		const findings = scanSource(ACTIVATED, SOURCE).filter(
			(finding) => finding.rule === "expression-literal",
		);
		expect(findings.map((finding) => finding.text)).toEqual([
			"Not signed in with Radient",
			"Not signed in yet",
			"Nothing is connected",
			"Connected directly to ${x}",
			"First line",
			"Second line",
		]);
	});

	it("reads app/ files with rules 1-3 (since #227) plus this rule where activated", () => {
		expect(expressionRuleActive("app/(app)/session/[id].tsx")).toBe(true);
		const findings = scanSource(
			APP,
			[
				'const t = row ? row.summary : "Video";',
				"<Text>Plain prose here.</Text>",
			].join("\n"),
		);
		expect(findings.map((finding) => finding.text).sort()).toEqual([
			"Plain prose here.",
			"Video",
		]);
		expect(findings.map((finding) => finding.rule)).toContain(
			"expression-literal",
		);
		expect(findings.map((finding) => finding.rule)).toContain("jsx-text");
	});

	it("is NOT applied to a file outside the activation scope", () => {
		expect(expressionRuleActive(ELSEWHERE)).toBe(false);
		expect(scanSource(ELSEWHERE, SOURCE)).toHaveLength(0);
		expect(EXPRESSION_LITERAL_SCOPE.some((entry) => entry === ELSEWHERE)).toBe(
			false,
		);
	});

	it("leaves classes, identifiers, optional chaining, keyed calls and object values alone", () => {
		const findings = scanSource(
			ACTIVATED,
			[
				'const a = wide ? "min-w-0 flex-1 gap-1" : "flex-row items-center";',
				'const b = mode ? "primary" : "secondary";',
				'const c = row?.name ?? t("mobile.settings.none");',
				'const d = { title: "A property value" };',
				"const e = ready ? `${count}` : `${a}-${b}`;",
				"function g() { throw new RangeError(`Bad value ${x}`); }",
			].join("\n"),
		);
		expect(findings).toHaveLength(0);
	});

	/* QA Q1: the lookback used to stop at any line ending in `{`/`}`/`;`, so a
	 * multi-line keyed `t(..., {...})` branch hid the `?` that opened the ternary
	 * and an else-literal after it had 0 findings. These are the two shapes QA
	 * reproduced (restoring the English in the session cue and in Settings). */
	it("finds an else-literal after a multi-line keyed branch", () => {
		const findings = scanSource(
			ACTIVATED,
			[
				"<Text>",
				"\t{regionAtBottom",
				'\t\t? t("mobile.session.region.end")',
				"\t\t: hiddenRegionLabels.length > 0",
				'\t\t\t? t("mobile.session.region.below_labels", {',
				'\t\t\t\t\tlabels: hiddenRegionLabels.join(" | "),',
				"\t\t\t\t})",
				'\t\t\t: "more below · scroll ↓"}',
				"</Text>",
				"<Text>",
				"\t{route",
				"\t\t? route.mode === 'radient'",
				'\t\t\t? t("mobile.settings.account.route_radient")',
				'\t\t\t: t("mobile.settings.account.route_direct", {',
				"\t\t\t\t\tbaseUrl: route.baseUrl,",
				"\t\t\t\t})",
				'\t\t: "No connection yet"}',
				"</Text>",
			].join("\n"),
		).filter((finding) => finding.rule === "expression-literal");
		expect(findings.map((finding) => finding.text)).toEqual([
			"more below · scroll ↓",
			"No connection yet",
		]);
	});

	it("does not read a later object property as the else of an earlier ternary", () => {
		const findings = scanSource(
			ACTIVATED,
			[
				"const row = {",
				'\tlabel: ready ? t("mobile.settings.ready") : t("mobile.settings.idle", {',
				"\t\tn: 1,",
				"\t}),",
				'\ttitle: "A property value",',
				"};",
			].join("\n"),
		);
		expect(findings).toHaveLength(0);
	});

	it("activates rule 4 on the agent-job screen", () => {
		expect(
			expressionRuleActive("app/(app)/session/[id]/agent/[jobId].tsx"),
		).toBe(true);
	});

	it("does not let a JSX apostrophe hide the literals below it", () => {
		const findings = scanSource(
			ACTIVATED,
			[
				"<Text>This phone's own size.</Text>",
				'const a = x ? "After the apostrophe" : "";',
			].join("\n"),
		);
		expect(findings.map((finding) => finding.text)).toContain(
			"After the apostrophe",
		);
	});

	it("is reported as added by the ratchet until it is keyed", () => {
		const found = scanSource(ACTIVATED, SOURCE);
		expect(ratchet([], found).added.length).toBeGreaterThan(0);
		expect(
			ratchet(buildBaseline(found, ACCOUNTABLE), found).added,
		).toHaveLength(0);
	});
});

describe("the ratchet", () => {
	const [finding] = scanSource(FILE, "<Text>Connect a computer.</Text>");
	if (finding === undefined) throw new Error("fixture produced no finding");

	it("reports a finding that is not baselined as added", () => {
		const result = ratchet([], [finding]);
		expect(result.added).toHaveLength(1);
		expect(result.stale).toHaveLength(0);
	});

	it("accepts a baselined finding", () => {
		const baseline = buildBaseline([finding], ACCOUNTABLE);
		const result = ratchet(baseline, [finding]);
		expect(result.added).toHaveLength(0);
		expect(result.stale).toHaveLength(0);
	});

	it("reports a baselined finding that is gone as stale", () => {
		const baseline = buildBaseline([finding], ACCOUNTABLE);
		const result = ratchet(baseline, []);
		expect(result.added).toHaveLength(0);
		expect(result.stale).toHaveLength(1);
	});

	it("deduplicates repeated literals so the baseline is a set", () => {
		const repeated = [finding, { ...finding, line: 99 }];
		expect(buildBaseline(repeated, ACCOUNTABLE)).toHaveLength(1);
	});
});

describe("the baseline's growth check", () => {
	const entry = (file: string, text: string): BaselineEntry => ({
		file,
		text,
		owner: "o",
		payoff: "p",
	});

	it("only permits identities newly detected in the base by the new scanner", () => {
		const oldEntry = entry("a.tsx", "Old finding");
		const old = [oldEntry];
		const newlyDetected = entry("b.tsx", "Historical headline");
		const fresh = entry("c.tsx", "Fresh headline");
		const candidates = migrationCandidates(old, [oldEntry, newlyDetected], old);
		expect(candidates).toEqual([newlyDetected]);
		expect(validateGrowth(old, [newlyDetected, fresh], candidates)).toEqual([
			fresh,
		]);
		expect(migrationCandidates(old, [oldEntry], [])).toEqual([]);
	});

	it("reports an entry the base does not have", () => {
		const base = [entry("a.tsx", "One")];
		const head = [entry("a.tsx", "One"), entry("b.tsx", "Two")];
		expect(baselineGrowth(base, head).map((added) => added.text)).toEqual([
			"Two",
		]);
	});

	it("allows shrinking and ignores an edited owner or payoff", () => {
		const base = [entry("a.tsx", "One"), entry("b.tsx", "Two")];
		const head = [{ ...entry("a.tsx", "One"), owner: "someone else" }];
		expect(baselineGrowth(base, head)).toEqual([]);
	});

	it("flags an entry with a blank owner or payoff", () => {
		const bad = [
			{ file: "a.tsx", text: "One", owner: "o" },
			{ file: "b.tsx", text: "Two", owner: " ", payoff: "p" },
			entry("c.tsx", "Three"),
		];
		expect(unaccountable(bad).map((found) => found.file)).toEqual([
			"a.tsx",
			"b.tsx",
		]);
	});
});

describe("the tree scan covers app/ routes", () => {
	/* WHY: Expo Router screens live under `app/`, outside `src/`. Before the scan
	 * walked it, an unkeyed EmptyState headline in a route passed the ratchet. The
	 * negative control is the first case: the same literal in app/ must come back
	 * as a finding that `ratchet` reports as added, which is what fails the check. */
	const withTree = (
		files: Record<string, string>,
		run: (root: string) => void,
	) => {
		const root = mkdtempSync(join(tmpdir(), "scan-app-"));
		try {
			for (const [name, body] of Object.entries(files)) {
				mkdirSync(join(root, name, ".."), { recursive: true });
				writeFileSync(join(root, name), body);
			}
			run(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	};

	it("detects an unkeyed literal in an app/ route and the ratchet fails it", () => {
		withTree(
			{
				"app/example.tsx":
					'export default () => <EmptyState headline="Nothing here yet." />;\n',
			},
			(root) => {
				const findings = scanTree(root);
				expect(findings.map((f) => [f.file, f.text])).toEqual([
					["app/example.tsx", "Nothing here yet."],
				]);
				expect(ratchet([], findings).added).toHaveLength(1);
			},
		);
	});

	it("is clean once the route renders the literal through t()", () => {
		withTree(
			{
				"app/example.tsx":
					'export default () => <EmptyState headline={t("mobile.session.empty.headline")} />;\n',
			},
			(root) => expect(scanTree(root)).toEqual([]),
		);
	});

	it("still scans a tree that has no app/ directory", () => {
		withTree({ "src/a.tsx": "export const a = 1;\n" }, (root) =>
			expect(scanTree(root)).toEqual([]),
		);
	});
});
