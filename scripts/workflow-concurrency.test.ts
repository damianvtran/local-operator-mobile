/**
 * Concurrency keys, pinned — because the failure they prevent is silence.
 *
 * GitHub keeps ONE pending run per concurrency group: when a run queues against a
 * group that already holds a pending run, the OLDER pending run is cancelled. It
 * never starts, no job is created, and its conclusion reads `cancelled` — the
 * least visible outcome a run can have. So two different pieces of work sharing
 * one group means one of them is dropped silently, and the fix is an expression:
 * exactly the kind of thing a later tidy-up flattens back, because
 * `${{ github.workflow }}-${{ github.ref }}` looks obviously correct until you
 * know this rule. Measured twice, in both directions: dispatch 40157909029 on
 * `main`, queued 03:21:30Z on 2026-10-25, was cancelled at 03:37:41Z one second
 * after schedule run 40158909122 was created; and the other way round, the push
 * run for a merged PR (39543983044, 2026-10-21 04:25:45Z) was cancelled at
 * 04:26:54Z with zero jobs, one second after a dispatch (39544082930) was
 * created in the same lane.
 *
 * WHY THIS GUARD IS STATIC. The REST API does not expose a run's concurrency
 * group: `actions/runs` reports the trigger, the ref, the conclusion and the job
 * list, but never the lane the run competed in, so no test here — or anywhere
 * else offline — can read back which group a real run occupied. This therefore
 * evaluates each workflow's own `concurrency.group` expression under the service's
 * documented semantics (`&&`/`||` return an operand, `format`, an empty `inputs`
 * context outside a dispatch) and asserts the properties a lane must have. It is a
 * check on the file, not a GitHub simulation: a future key that satisfies these
 * properties and still collides would pass, which is why every claim below is
 * paired with a negative control that proves the check can fail.
 *
 * WHAT IT COVERS. Every workflow in `.github/workflows` whose triggers can start
 * two runs on one ref. `pull_request` runs live in `refs/pull/*`, a namespace no
 * other trigger here produces, so a PR run can only ever race another PR run —
 * the intended supersede. `push`, `schedule` and `workflow_dispatch` all reach
 * branch refs, and `push` on a tag reaches the same ref a dispatch can pick, so
 * each of those combinations must key on `github.event_name`. A workflow with no
 * `concurrency:` block has no group to compete in and cannot drop a run; it is
 * listed, not skipped, so adding a block to one is a decision the suite reports.
 *
 * The reader is structure-tolerant (comments, key order, block or flow lists,
 * `.yml` or `.yaml`) but fails closed: an argument, operator or function call it
 * cannot model throws rather than returning a lane that might be wrong.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIR = fileURLToPath(
	new URL("../.github/workflows", import.meta.url),
);

/**
 * Line shapes every reader below matches, hoisted because a regex literal inside
 * a function is rebuilt on each call and biome flags it. None of these carry the
 * global flag, so sharing one instance between calls cannot leak state.
 */
const COMMENT = /#.*$/;
const INDENTED = /^\s/;
const INDENT_AT = /\S/;
const FILTER_KEY = /^\s*(branches|tags)\s*:\s*(.*)$/;
const LIST_ITEM = /^\s*-\s*(.+)$/;
const TRIGGER_KEY = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/;
const SCALAR = /^\s+([\w-]+):\s*(.*)$/;
const NUMBER = /^-?\d/;
const IDENTIFIER = /^[A-Za-z_]/;
const YAML_FILE = /\.ya?ml$/;

/**
 * The branch a `schedule` run checks out and the branch `workflow_dispatch`
 * defaults to. Every branch-push trigger in this repository names it, so the
 * guard can place the nightly in a ref without asking GitHub which branch is
 * default.
 */
const DEFAULT_BRANCH = "main";

/* -------------------------------------------------------------------------- */
/* Reading the file                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The lines belonging to one top-level `key:` — the inline value when the key has
 * one (`on: [push]`), and otherwise the indented body, comments included so the
 * callers can decide whether a comment is significant. The block ends at the next
 * top-level key, which is what makes this tolerant of key order.
 */
function keyedBlock(
	source: string,
	key: string,
): { inline: string; body: string[] } | null {
	const header = new RegExp(`^(?:"${key}"|'${key}'|${key}):\\s*(.*)$`);
	const lines = source.split("\n");
	const start = lines.findIndex((line) => header.test(line));
	if (start === -1) return null;

	const inline = (header.exec(lines[start] ?? "")?.[1] ?? "")
		.replace(COMMENT, "")
		.trim();
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		const trimmed = line.trim();
		if (trimmed !== "" && !trimmed.startsWith("#") && !INDENTED.test(line))
			break;
		body.push(line);
	}
	return { inline, body };
}

/** `[main, develop]` and `main, develop` both mean the same two names. */
function asList(value: string): string[] {
	return value
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
		.filter((item) => item !== "");
}

/** The `branches:`/`tags:` filters of a `push:` trigger, block or flow form. */
function filtersOf(lines: string[]): { branches: string[]; tags: string[] } {
	const filters: { branches: string[]; tags: string[] } = {
		branches: [],
		tags: [],
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const match = FILTER_KEY.exec(line);
		if (!match) continue;
		const list = match[1] === "branches" ? filters.branches : filters.tags;
		const inline = (match[2] ?? "").replace(COMMENT, "").trim();
		if (inline !== "") {
			list.push(...asList(inline));
			continue;
		}
		const ownerIndent = line.search(INDENT_AT);
		for (const item of lines.slice(index + 1)) {
			if (item.trim() === "" || item.trim().startsWith("#")) continue;
			const entry = LIST_ITEM.exec(item);
			if (!entry || item.search(INDENT_AT) <= ownerIndent) break;
			list.push((entry[1] ?? "").replace(COMMENT, "").trim());
		}
	}
	return filters;
}

interface Trigger {
	/** The `github.event_name` this trigger produces. */
	event: string;
	/** Whether it can start a run on `ref`. */
	firesOn: (ref: string) => boolean;
	/** A ref it can fire on, used to render its lane. */
	sample: string;
}

/** GitHub's branch/tag filter syntax, reduced to what these workflows use. */
function globMatches(pattern: string, name: string): boolean {
	const body = pattern
		.split("**")
		.map((part) =>
			part
				.split("*")
				.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join("[^/]*"),
		)
		.join(".*");
	return new RegExp(`^${body}$`).test(name);
}

/** GitHub's ref prefixes, so the slice lengths are named rather than guessed. */
const HEADS = "refs/heads/";
const TAGS = "refs/tags/";

/** A concrete ref a filtered pattern can match, so its lane can be rendered. */
const sampleOf = (pattern: string): string => pattern.replace(/\*/g, "sample");

/**
 * Every trigger a workflow declares, as the refs it can fire on. Unknown trigger
 * names are ignored on purpose: `merge_group` and `release` fire on ref namespaces
 * of their own, which no other trigger in this repository can reach.
 */
function triggersOf(source: string): {
	triggers: Trigger[];
	filters: { branches: string[]; tags: string[] };
} {
	const block = keyedBlock(source, "on");
	if (!block) throw new Error("workflow has no top-level `on:` block");

	const names: string[] = [];
	let filters = { branches: [] as string[], tags: [] as string[] };

	if (block.inline !== "") {
		names.push(...asList(block.inline));
	} else {
		const content = block.body.filter(
			(line) => line.trim() !== "" && !line.trim().startsWith("#"),
		);
		if (content.length === 0) throw new Error("`on:` declares no trigger");
		const indent = Math.min(...content.map((line) => line.search(INDENT_AT)));
		for (let index = 0; index < content.length; index++) {
			const line = content[index] ?? "";
			// Anything deeper than a trigger name belongs to that trigger's config.
			if (line.search(INDENT_AT) !== indent) continue;
			const match = TRIGGER_KEY.exec(line);
			if (!match) throw new Error(`unreadable line under \`on:\`: ${line}`);
			const name = match[1] ?? "";
			names.push(name);
			if (name !== "push") continue;
			const nested: string[] = [];
			for (const next of content.slice(index + 1)) {
				if (next.search(INDENT_AT) <= indent) break;
				nested.push(next);
			}
			filters = filtersOf(nested);
		}
	}

	const triggers: Trigger[] = [];
	for (const name of new Set(names)) {
		if (name === "push") {
			// `push:` with no filters fires for both branches and tags; a filter on
			// one of them excludes the other, which is how release.yml stays tag-only.
			const branches =
				filters.branches.length > 0
					? filters.branches
					: filters.tags.length === 0
						? ["**"]
						: [];
			const tags =
				filters.tags.length > 0
					? filters.tags
					: filters.branches.length === 0
						? ["**"]
						: [];
			for (const pattern of branches) {
				triggers.push({
					event: "push",
					firesOn: (ref) =>
						ref.startsWith(HEADS) &&
						globMatches(pattern, ref.slice(HEADS.length)),
					sample: `${HEADS}${sampleOf(pattern)}`,
				});
			}
			for (const pattern of tags) {
				triggers.push({
					event: "push",
					firesOn: (ref) =>
						ref.startsWith(TAGS) &&
						globMatches(pattern, ref.slice(TAGS.length)),
					sample: `${TAGS}${sampleOf(pattern)}`,
				});
			}
			continue;
		}
		if (name === "schedule") {
			const ref = `${HEADS}${DEFAULT_BRANCH}`;
			triggers.push({
				event: name,
				firesOn: (candidate) => candidate === ref,
				sample: ref,
			});
			continue;
		}
		if (
			name === "workflow_dispatch" ||
			name === "workflow_call" ||
			name === "workflow_run"
		) {
			// A dispatch picks its ref, a called workflow runs on its caller's.
			triggers.push({
				event: name,
				firesOn: (ref) => ref.startsWith(HEADS) || ref.startsWith(TAGS),
				sample: `${HEADS}${DEFAULT_BRANCH}`,
			});
			continue;
		}
		if (name === "pull_request" || name === "pull_request_target") {
			triggers.push({
				event: name,
				firesOn: (ref) => ref.startsWith("refs/pull/"),
				sample: "refs/pull/1/merge",
			});
		}
	}

	return { triggers, filters };
}

/* -------------------------------------------------------------------------- */
/* Evaluating one lane                                                        */
/* -------------------------------------------------------------------------- */

type Value = string | number | boolean | null;

/** What a run's concurrency expression can read. */
interface RunIdentity {
	/** `github.event_name`. */
	event: string;
	/** `github.ref`. */
	ref: string;
	/** `inputs.proof_mode`; `null` is the empty `inputs` context a non-dispatch event has. */
	proof: string | null;
}

/** GitHub's falsy set, which decides which operand `&&`/`||` returns. */
const isFalsy = (value: Value): boolean =>
	value === null || value === false || value === "" || value === 0;

function tokenize(expression: string): string[] {
	const tokens: string[] = [];
	const pattern =
		/\s*(\|\||&&|==|!=|'[^']*'|[()!,]|[A-Za-z_][\w.]*|-?\d+(?:\.\d+)?)/g;
	let at = 0;
	let match = pattern.exec(expression);
	while (match !== null) {
		if (match.index !== at) {
			throw new Error(
				`cannot tokenize the concurrency expression at ${at}: ${expression.slice(at)}`,
			);
		}
		tokens.push(match[1] ?? "");
		at = pattern.lastIndex;
		match = pattern.exec(expression);
	}
	if (expression.slice(at).trim() !== "") {
		throw new Error(
			`cannot tokenize the concurrency expression: ${expression.slice(at)}`,
		);
	}
	return tokens;
}

/**
 * The value one path contributes to a lane. A path this guard does not model is a
 * failure rather than a blank: a key argument nobody can reason about is exactly
 * the one that needs a human, and a silently empty substitution would make the
 * collision check meaningless.
 */
function lookup(path: string, run: RunIdentity): Value {
	if (path === "github.workflow") return "WORKFLOW";
	if (path === "github.event_name") return run.event;
	if (path === "github.ref") return run.ref;
	if (path === "inputs.proof_mode") return run.proof;
	throw new Error(
		`the concurrency expression reads a value this guard cannot model: ${path}`,
	);
}

/**
 * One expression, evaluated with the service's operator semantics: `&&`/`||`
 * return an operand instead of a boolean, and `format` substitutes `{n}`. Only
 * what a lane can contain is understood; anything else throws.
 */
function evaluate(source: string, run: RunIdentity): Value {
	const tokens = tokenize(source);
	let at = 0;
	const peek = (): string => tokens[at] ?? "";
	const take = (): string => tokens[at++] ?? "";

	// `!` → `==`/`!=` → `&&` → `||`, tightest first, each left-associative.
	const primary = (): Value => {
		const token = take();
		if (token === "(") {
			const value = or();
			if (take() !== ")") throw new Error(`unbalanced "(" in ${source}`);
			return value;
		}
		if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
		if (token === "true") return true;
		if (token === "false") return false;
		if (token === "null") return null;
		if (NUMBER.test(token)) return Number(token);
		if (!IDENTIFIER.test(token)) {
			throw new Error(
				`unreadable token in the concurrency expression: ${token}`,
			);
		}
		if (peek() !== "(") return lookup(token, run);
		if (token !== "format") {
			throw new Error(
				`the concurrency expression calls ${token}(), which this guard cannot model`,
			);
		}
		take();
		const args: Value[] = [];
		if (peek() !== ")") {
			for (;;) {
				args.push(or());
				if (peek() !== ",") break;
				take();
			}
		}
		if (take() !== ")") throw new Error(`unclosed \`format(\` in ${source}`);
		const [template, ...rest] = args;
		if (typeof template !== "string") {
			throw new Error(`format() needs a string template: ${source}`);
		}
		return template.replace(/\{(\d+)\}/g, (_, index: string) => {
			const value = rest[Number(index)];
			return value === undefined || value === null ? "" : String(value);
		});
	};

	const unary = (): Value => {
		if (peek() !== "!") return primary();
		take();
		return !isFalsy(unary());
	};

	const equality = (): Value => {
		let left = unary();
		while (peek() === "==" || peek() === "!=") {
			const operator = take();
			const right = unary();
			// The lanes compare strings with string literals; `null` reads as "null"
			// and can never equal a proof name, which is the only case that occurs.
			const same = String(left) === String(right);
			left = operator === "==" ? same : !same;
		}
		return left;
	};

	const and = (): Value => {
		let left = equality();
		while (peek() === "&&") {
			take();
			const right = equality();
			left = isFalsy(left) ? left : right;
		}
		return left;
	};

	const or = (): Value => {
		let left = and();
		while (peek() === "||") {
			take();
			const right = and();
			left = isFalsy(left) ? right : left;
		}
		return left;
	};

	const value = or();
	if (at !== tokens.length) {
		throw new Error(
			`unconsumed tokens in the concurrency expression: ${tokens.slice(at).join(" ")}`,
		);
	}
	return value;
}

/**
 * The group one run resolves to: every `${{ … }}` in the scalar evaluated and
 * spliced back between the literal text that separates them. A scalar with no
 * interpolation is one literal lane for every run — the bug this file exists to
 * catch — so it is reported rather than rendered.
 */
function lane(expression: string, run: RunIdentity): string {
	let at = 0;
	let rendered = "";
	for (;;) {
		const open = expression.indexOf("${{", at);
		if (open === -1) {
			rendered += expression.slice(at);
			break;
		}
		const close = expression.indexOf("}}", open);
		if (close === -1) {
			throw new Error(`unclosed \${{ in the group expression: ${expression}`);
		}
		rendered += expression.slice(at, open);
		const value = evaluate(expression.slice(open + 3, close), run);
		rendered += value === null ? "" : String(value);
		at = close + 2;
	}
	const resolved = rendered.trim();
	if (resolved === expression.trim()) {
		throw new Error(
			`no interpolation, so this is one lane for every run: ${expression}`,
		);
	}
	return resolved;
}

/* -------------------------------------------------------------------------- */
/* The repository's workflows                                                 */
/* -------------------------------------------------------------------------- */

interface WorkflowFile {
	file: string;
	triggers: Trigger[];
	filters: { branches: string[]; tags: string[] };
	group: string | null;
	cancelInProgress: string | null;
}

function concurrencyOf(source: string): {
	group: string | null;
	cancelInProgress: string | null;
} {
	const block = keyedBlock(source, "concurrency");
	if (block === null) return { group: null, cancelInProgress: null };
	const values = new Map<string, string>();
	for (const line of block.body) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const match = SCALAR.exec(line);
		if (!match)
			throw new Error(`unreadable line inside \`concurrency:\`: ${line}`);
		values.set(match[1] ?? "", (match[2] ?? "").trim());
	}
	return {
		group: values.get("group") ?? null,
		cancelInProgress: values.get("cancel-in-progress") ?? null,
	};
}

const workflows: WorkflowFile[] = readdirSync(WORKFLOW_DIR)
	.filter((file) => YAML_FILE.test(file))
	.sort()
	.map((file) => {
		const source = readFileSync(join(WORKFLOW_DIR, file), "utf8");
		return { file, ...triggersOf(source), ...concurrencyOf(source) };
	});

/** Trigger pairs that can start two runs on one ref, with a ref they share. */
function collisions(
	triggers: Trigger[],
): { a: Trigger; b: Trigger; ref: string }[] {
	const refs = new Set<string>([`${HEADS}${DEFAULT_BRANCH}`]);
	for (const trigger of triggers) {
		if (trigger.sample !== "") refs.add(trigger.sample);
	}
	const cases: { a: Trigger; b: Trigger; ref: string }[] = [];
	for (let first = 0; first < triggers.length; first++) {
		for (let second = first + 1; second < triggers.length; second++) {
			const a = triggers[first];
			const b = triggers[second];
			if (!a || !b) continue;
			// Two triggers of one event ARE one lane by definition: a second cron
			// entry, or two branch filters of one `push`, are meant to supersede each
			// other. Only a cross-event pair can drop work that the other run would
			// have done, which is the defect this suite is about.
			if (a.event === b.event) continue;
			for (const ref of refs) {
				if (a.firesOn(ref) && b.firesOn(ref)) {
					cases.push({ a, b, ref });
					break;
				}
			}
		}
	}
	return cases;
}

const covered = workflows.filter(
	(workflow) => collisions(workflow.triggers).length > 0,
);

/**
 * Workflows the trigger rule deliberately does not apply to. Each entry names the
 * reason AND the structural premise that keeps the reason true — asserted below,
 * so the exemption cannot quietly stop being one. Absence from this map is not an
 * escape hatch: everything else covered is checked.
 */
const EXEMPT: Record<
	string,
	{ reason: string; premise: (w: WorkflowFile) => boolean }
> = {
	"release.yml": {
		reason:
			"its two triggers meet only on a tag, where both are the same release of the same artefacts; keying them apart would let a dispatch race the push run into one Release and a double store upload. `cancel-in-progress: false` already keeps a running release alive, and replacing a *pending* duplicate with the newer identical run loses no work.",
		// Exact, not approximate: every pair that could collide here must be a tag
		// push against a dispatch — the same release twice — and the push must stay
		// tag-only. Add a branch push or a cron to release.yml and the premise fails,
		// which is how the exemption stops being one the moment its reason does.
		premise: (workflow) =>
			workflow.filters.branches.length === 0 &&
			collisions(workflow.triggers).every(
				({ a, b, ref }) =>
					ref.startsWith(TAGS) &&
					[a.event, b.event].includes("push") &&
					[a.event, b.event].includes("workflow_dispatch"),
			),
	},
};

/* -------------------------------------------------------------------------- */
/* The guard                                                                  */
/* -------------------------------------------------------------------------- */

describe("workflow concurrency keys", () => {
	it("covers the workflows whose triggers can start two runs on one ref", () => {
		const names = covered.map((workflow) => workflow.file);
		// Non-vacuity: if the reader stops finding these, the guard has gone quiet.
		for (const file of ["android.yml", "ci.yml", "e2e.yml", "ios.yml"]) {
			expect(names).toContain(file);
		}
	});

	it("classifies every covered workflow: a lane, an exemption, or no lane at all", () => {
		// Deliberately exact. A new workflow with colliding triggers lands here and
		// has to be classified — either by keying on `github.event_name`, by being
		// added to EXEMPT with a reason, or by having no concurrency block at all.
		const noLane = covered
			.filter((workflow) => workflow.group === null)
			.map((workflow) => workflow.file);
		const exempt = covered
			.filter((workflow) => workflow.group !== null && EXEMPT[workflow.file])
			.map((workflow) => workflow.file);
		expect(noLane).toEqual(["flake-report.yml"]);
		expect(exempt).toEqual(["release.yml"]);
	});

	for (const workflow of covered) {
		const cases = collisions(workflow.triggers);
		const group = workflow.group;
		const exemption = EXEMPT[workflow.file];

		describe(workflow.file, () => {
			if (group === null) {
				it("has no concurrency block, so no run can replace another", () => {
					// Nothing to assert about a key that does not exist; the classification
					// above is what makes the absence visible.
					expect(workflow.cancelInProgress).toBeNull();
				});
				return;
			}

			if (exemption) {
				it("is exempt only while its stated premise holds", () => {
					expect(exemption.premise(workflow), exemption.reason).toBe(true);
				});
				it("must lose its exemption as soon as it keys on the trigger", () => {
					expect(group).not.toContain("github.event_name");
				});
				return;
			}

			it("keys the group on an expression", () => {
				expect(group.startsWith("${{") && group.endsWith("}}")).toBe(true);
			});

			it("renders a different lane for every pair of triggers that can share a ref", () => {
				for (const { a, b, ref } of cases) {
					const first = lane(group, { event: a.event, ref, proof: null });
					const second = lane(group, { event: b.event, ref, proof: null });
					expect(
						first,
						`a ${a.event} run and a ${b.event} run on ${ref} share the lane ${first}`,
					).not.toBe(second);
				}
			});

			it("collapses those lanes once github.event_name is a constant, so the check can fail", () => {
				// The negative control, aimed at the real file: the trigger variable is
				// what keeps these lanes apart, so replacing it with a constant must put
				// both triggers back into one lane. If they stay apart, the check above
				// passes for some other reason and is not the pin it claims to be.
				const flattened = group.replaceAll("github.event_name", "'constant'");
				for (const { a, b, ref } of cases) {
					expect(
						lane(flattened, { event: a.event, ref, proof: null }),
						`${a.event} and ${b.event} on ${ref} differ without the trigger in the key`,
					).toBe(lane(flattened, { event: b.event, ref, proof: null }));
				}
			});
		});
	}
});

/* -------------------------------------------------------------------------- */
/* The two lanes e2e.yml keeps on their old keys, and its proof suffix         */
/* -------------------------------------------------------------------------- */

const e2e = workflows.find((workflow) => workflow.file === "e2e.yml");
if (!e2e?.group) throw new Error("e2e.yml is missing its concurrency group");

const IOS_LANE =
	/inputs\.proof_mode\s*==\s*'account-routing-ios-proof'\s*&&\s*format\('account-routing-ios-\{0\}',\s*github\.ref\)/;
const ANDROID_LANE =
	/inputs\.proof_mode\s*==\s*'account-routing-android-proof'\s*&&\s*format\('account-routing-android-\{0\}',\s*github\.ref\)/;

describe("e2e.yml: the manual lane carries its proof", () => {
	const main = `refs/heads/${DEFAULT_BRANCH}`;
	const dispatch = (proof: string | null): string =>
		lane(e2e.group ?? "", { event: "workflow_dispatch", ref: main, proof });

	it("splits two different proofs, and folds an inputs-less dispatch into `full`", () => {
		expect(dispatch("s15-proof")).not.toBe(dispatch("full"));
		// `inputs.proof_mode || 'full'` is the only thing making the second half
		// true: drop the fallback and a dispatch that supplies no proof renders its
		// lane with a trailing dash instead of `-full`, so this line fails.
		expect(dispatch(null)).toBe(dispatch("full"));
	});

	it("keeps the two account-routing audit lanes on their exact previous keys", () => {
		// Only a dispatch can carry a proof, so these keys cannot collide with a
		// scheduled or pushed run; their stability is what the artefacts and
		// baselines are read under, so they must not gain a suffix.
		expect(e2e.group).toMatch(IOS_LANE);
		expect(e2e.group).toMatch(ANDROID_LANE);
	});

	it("still queues on main instead of cancelling, and still supersedes a same-proof dispatch elsewhere", () => {
		// The reason a manual lane may queue at all: a RUNNING run on `main` is never
		// cancelled. (It is not immunity from every cancel — one pending run per
		// group, so a third run in a main lane still replaces whichever waited.)
		expect(e2e.cancelInProgress).toContain("github.ref != 'refs/heads/main'");
		// The account-routing proofs run on main and must never cancel each other.
		for (const proof of [
			"account-routing-ios-proof",
			"account-routing-android-proof",
		]) {
			expect(e2e.cancelInProgress).toContain(`inputs.proof_mode != '${proof}'`);
		}
	});
});
