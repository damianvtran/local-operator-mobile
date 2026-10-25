/**
 * The E2E workflow's concurrency key, pinned — because the failure it prevents
 * is silence.
 *
 * GitHub keeps ONE pending run per concurrency group: when a second run queues
 * against a group that already has a pending run, the OLDER pending one is
 * cancelled. It never starts, no job is created, and its conclusion reads
 * `cancelled` — the least visible outcome a run can have. So two different things
 * sharing a group means one of them is silently dropped, and the fix is an
 * expression, which is exactly the kind of thing a later tidy-up flattens back:
 * `${{ github.workflow }}-${{ github.ref }}` looks obviously correct until you
 * know this rule. Measured 2026-10-25: manual run 40157909029 — dispatched on
 * `main`, queued 03:21:30Z — was cancelled at 03:37:41Z, the second after
 * schedule run 40158909122 was created in the same group.
 *
 * WHAT THIS TEST CAN AND CANNOT DO. GitHub expressions cannot be evaluated
 * locally: `format`, the truthiness of `&&`/`||` and an empty `inputs` context on
 * a non-dispatch event are the service's semantics, not YAML's. This therefore
 * reads the workflow and asserts the properties the key must have — the trigger
 * is part of every lane built from the workflow name, a manual lane also carries
 * its proof, and the two account-routing lanes keep their exact previous
 * strings — and it renders those lanes for a schedule run and a manual run on the
 * same ref to require the strings to differ. That is a structure-and-render
 * check on the file, not a GitHub simulation: a future key that satisfies these
 * properties and still collides would pass. It fails on the pre-fix file (see the
 * pull request that added it), which is the property that makes it a guard.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
	new URL("../.github/workflows/e2e.yml", import.meta.url),
);

/** The two `group`/`cancel-in-progress` scalars, and the lane anchors they must keep. */
const CONCURRENCY_HEADER = /^concurrency:\s*$/;
const INDENTED = /^\s/;
const SCALAR = /^\s+([\w-]+):\s*(.*)$/;
const IOS_LANE =
	/inputs\.proof_mode\s*==\s*'account-routing-ios-proof'\s*&&\s*format\('account-routing-ios-\{0\}',\s*github\.ref\)/;
const ANDROID_LANE =
	/inputs\.proof_mode\s*==\s*'account-routing-android-proof'\s*&&\s*format\('account-routing-android-\{0\}',\s*github\.ref\)/;
function concurrencyBlock(source: string): {
	group: string;
	cancelInProgress: string;
} {
	const lines = source.split("\n");
	const start = lines.findIndex((line) => CONCURRENCY_HEADER.test(line));
	if (start === -1) {
		throw new Error("e2e.yml has no top-level `concurrency:` block");
	}

	const values = new Map<string, string>();
	for (const line of lines.slice(start + 1)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		// The block ends at the next top-level key (`permissions:`, …).
		if (!INDENTED.test(line)) break;
		const match = SCALAR.exec(line);
		if (!match) {
			throw new Error(`unreadable line inside the concurrency block: ${line}`);
		}
		values.set(match[1] ?? "", (match[2] ?? "").trim());
	}

	const group = values.get("group");
	const cancelInProgress = values.get("cancel-in-progress");
	if (!group || !cancelInProgress) {
		throw new Error(
			"the concurrency block is missing `group` or `cancel-in-progress`",
		);
	}
	return { group, cancelInProgress };
}

interface FormatCall {
	template: string;
	args: string[];
}

/**
 * Every `format('…', a, b)` in an expression. Its arguments here are plain
 * identifiers, so scanning to the closing paren is exact — and a future key that
 * nests a call throws instead of being under-read.
 */
function formatCalls(expression: string): FormatCall[] {
	const calls: FormatCall[] = [];
	for (const match of expression.matchAll(/format\(([^()]*)\)/g)) {
		const [rawTemplate, ...rest] = (match[1] ?? "").split(",");
		const template = (rawTemplate ?? "").trim().replace(/^'|'$/g, "");
		const args = rest.map((arg) => arg.trim()).filter((arg) => arg !== "");
		if (template.includes("(") || args.some((arg) => arg.includes("("))) {
			throw new Error(
				`${match[0]} nests a call; this reader cannot see into it`,
			);
		}
		calls.push({ template, args });
	}
	return calls;
}

const placeholders = (template: string): number =>
	[...template.matchAll(/\{(\d+)\}/g)].length;

/**
 * A lane rendered for one run identity. Only the substitutions the key uses are
 * understood; anything else is a failure, not a guess — a key argument this test
 * cannot reason about is exactly the one that needs a human to look at it.
 */
function render(
	call: FormatCall,
	run: { event: string; proof: string },
): string {
	const values = call.args.map((arg) => {
		if (arg === "github.workflow") return "WORKFLOW";
		if (arg === "github.event_name") return run.event;
		if (arg === "github.ref") return "refs/heads/main";
		if (arg === "inputs.proof_mode" || arg === "inputs.proof_mode || 'full'") {
			return run.proof;
		}
		throw new Error(
			`the concurrency key gained an unrenderable argument: ${arg}`,
		);
	});
	return call.template.replace(
		/\{(\d+)\}/g,
		(_, index) => values[Number(index)] ?? "",
	);
}

const source = readFileSync(WORKFLOW_PATH, "utf8");
const { group, cancelInProgress } = concurrencyBlock(source);
const calls = formatCalls(group);

const isExpression = (value: string): boolean =>
	value.startsWith("${{") && value.endsWith("}}");

describe("e2e.yml's concurrency key keeps the nightly off the manual lane", () => {
	it("is an expression, not a literal that would put every run in one group", () => {
		expect(isExpression(group)).toBe(true);
		expect(isExpression(cancelInProgress)).toBe(true);
		// Anything but the substitutions above means the lanes cannot be reasoned
		// about here, so the guard would be vacuous.
		expect(calls.length).toBeGreaterThanOrEqual(2);
	});

	it("renders a schedule run and a manual run on the same ref into different groups", () => {
		// Every lane that templates the workflow name is a lane a schedule run and a
		// dispatch both reach; if any of them renders identically for the two, that
		// is the original bug — one of the two runs is dropped, not queued.
		const shared = calls.filter((call) =>
			call.args.includes("github.workflow"),
		);
		expect(shared.length).toBeGreaterThan(0);

		for (const call of shared) {
			const scheduled = render(call, { event: "schedule", proof: "" });
			const manual = render(call, {
				event: "workflow_dispatch",
				proof: "full",
			});
			expect(
				scheduled,
				`lane ${call.template} renders the same string for a schedule run and a manual run`,
			).not.toBe(manual);
		}
	});

	it("puts the requested proof in the manual lane, so two proofs never queue against each other", () => {
		const manual = calls.filter((call) =>
			call.args.some((arg) => arg.startsWith("inputs.proof_mode")),
		);
		expect(manual.length).toBeGreaterThan(0);

		for (const call of manual) {
			// A manual lane is a full identity: the proof alone is not a ref's lane.
			expect(call.args).toContain("github.event_name");
			expect(call.args).toContain("github.ref");
			// Every parameter is interpolated; an argument the template ignores would
			// make the "different proof, different lane" claim false.
			expect(placeholders(call.template)).toBe(call.args.length);

			const full = render(call, { event: "workflow_dispatch", proof: "full" });
			const s15 = render(call, {
				event: "workflow_dispatch",
				proof: "s15-proof",
			});
			expect(full).not.toBe(s15);
		}
	});

	it("keeps the two account-routing audit lanes on their exact previous keys", () => {
		// Only a dispatch can carry a proof, so these keys cannot collide with a
		// scheduled or pushed run; their stability is what the artefacts and
		// baselines are read under, so they must not gain a suffix.
		expect(group).toMatch(IOS_LANE);
		expect(group).toMatch(ANDROID_LANE);
	});

	it("still queues on main instead of cancelling, and still supersedes a branch push", () => {
		// The reason the manual lane may queue at all: nothing on `main` is
		// cancelled. Removing this line makes a second dispatch kill the first.
		expect(cancelInProgress).toContain("github.ref != 'refs/heads/main'");
		// The account-routing proofs run on main and must never cancel each other.
		for (const proof of [
			"account-routing-ios-proof",
			"account-routing-android-proof",
		]) {
			expect(cancelInProgress).toContain(`inputs.proof_mode != '${proof}'`);
		}
	});
});
