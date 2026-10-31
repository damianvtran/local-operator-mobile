import { describe, expect, it } from "vitest";

import {
	type BaselineEntry,
	baselineGrowth,
	buildBaseline,
	ratchet,
	unaccountable,
} from "./ratchet.ts";
import { scanSource } from "./scan-strings.ts";

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
