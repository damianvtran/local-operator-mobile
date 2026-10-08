import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE FIGURES THE DOCUMENTS STATE ARE THE PLAN THE HARNESS PRINTS.
 *
 * Why this exists rather than another hand sweep: the tier figures have been wrong
 * in this file set **six times** (rounds 1-5), every time as a stale copy of a
 * number the harness prints for itself. A reviewer cannot be expected to re-derive
 * them by eye, and a sweep is only true until the next commit touches a cell list.
 * So the numbers are read FROM the harness — `--plan` per tier, the same command
 * the documents tell a reader to run — and every equation-shaped statement in the
 * tree has to agree with them.
 *
 * WHAT IT COVERS: plan lines (`N cells x M frame(s) = K frames`), derived deadlines
 * (`deadline: K s` and `a deadline of K s`), per-cell rate products
 * (`N cells x R s = K s`).
 *
 * WHAT IT DOES NOT COVER, and this is a real limit rather than a caveat: a figure that
 * stands alone with no equation around it. The documents legitimately carry many
 * counts that are not tier plans — the README's one-phone sample (`58 cells`), a
 * dispatcher's partial plan (`400 cells`), a mean of 12 cells, a historical `256` from
 * the run that measured the rate — so a rule that forced every `N cells` to be a tier
 * count would fail on true statements. A bare `5,832 frames` is likewise not asserted:
 * the README quotes `58 frames` for a sample that is not a tier. What this gate does
 * catch is every figure stated IN AN EQUATION, which is where six rounds of sweeps
 * went wrong, and it catches a stale deadline wherever it is written.
 *
 * WHAT IT DOES NOT COVER, named rather than implied: prose minutes (`~78 minutes`)
 * are a *rate* the harness measures on a runner, not a number it prints, so a stale
 * minute figure is invisible here — those are checked by hand against the rate and
 * said so in each document; and a figure in a line that names a DIFFERENT ref
 * (`at 85b2785 it printed 858 cells`) is history and is deliberately not asserted.
 *
 * The relay is started by this test because `--plan` reads the declared cell list
 * from the scenario registry — the same reason the documents tell a reader to point
 * `--relay` at a mock before planning.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));

const SCANNED = [
	"docs/e2e/README.md",
	"docs/e2e/ci-notes.md",
	"tools/visual/matrix.ts",
	"tools/visual/capture.ts",
	"tools/lib/page.ts",
	".github/workflows/e2e.yml",
];

const TIERS = ["ci", "core", "full"] as const;
type Tier = (typeof TIERS)[number];

interface Plan {
	cells: number;
	frames: number;
	deadline: number;
}

let plans: Record<Tier, Plan> | null = null;
let relay: ChildProcess | null = null;

const relayUrl = "http://127.0.0.1:4493";

beforeAll(async () => {
	/* `spawn`, not `spawnSync`: the relay has to KEEP RUNNING while the plans are
	 *  read, so the synchronous call would block on it for its whole timeout. */
	relay = spawn(
		"node",
		["tools/mock-relay/relay.ts", "--scenario", "idle", "--port", "4493"],
		{ cwd: root, detached: true, stdio: "ignore" },
	);
	relay.unref();
	await new Promise((resolve) => setTimeout(resolve, 2500));
	const read = (tier: Tier): Plan | null => {
		const out = spawnSync(
			"node",
			[
				"tools/visual/capture.ts",
				"--dir",
				"dist",
				"--out",
				process.env.LOCAL_OPERATOR_SCRATCHPAD ?? ".",
				"--relay",
				relayUrl,
				"--plan",
				"--tier",
				tier,
				"--consecutive",
			],
			{ cwd: root, encoding: "utf8", timeout: 120000 },
		);
		const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
		const cells = text.match(/capture plan: (\d+) cells/);
		const frames = text.match(/= (\d+) frames/);
		const deadline = text.match(/deadline: (\d+) s/);
		if (!cells || !frames || !deadline) return null;
		return {
			cells: Number(cells[1]),
			frames: Number(frames[1]),
			deadline: Number(deadline[1]),
		};
	};
	const found = {} as Record<Tier, Plan>;
	let ok = true;
	for (const tier of TIERS) {
		const plan = read(tier);
		if (plan === null) {
			ok = false;
			break;
		}
		found[tier] = plan;
	}
	plans = ok ? found : null;
}, 240000);

afterAll(() => {
	const pid = relay?.pid;
	if (relay !== null && pid !== undefined) {
		// By exact pid, and only the process this test started.
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				/* already gone */
			}
		}
	}
});

describe("the figures in the tree are the plan the harness prints", () => {
	it("reads a plan for every tier — a missing plan is a failure, not a skip", () => {
		expect(plans).not.toBeNull();
		for (const tier of TIERS) {
			const plan = plans?.[tier];
			expect(plan?.cells ?? 0).toBeGreaterThan(0);
			// the harness derives its deadline at 3 s/cell, and states both
			expect(plan?.deadline).toBe((plan?.cells ?? 0) * 3);
			expect(plan?.frames).toBe((plan?.cells ?? 0) * 3);
		}
	});

	it("every plan, deadline and rate line in the tree agrees with one of them", () => {
		const known = plans;
		expect(known).not.toBeNull();
		const byCells = new Map<number, Plan>();
		for (const tier of TIERS) {
			const plan = known?.[tier];
			if (plan) byCells.set(plan.cells, plan);
		}

		const problems: string[] = [];
		for (const file of SCANNED) {
			const lines = readFileSync(join(root, file), "utf8").split("\n");
			lines.forEach((line, index) => {
				/* A statement pinned to another ref is history, not a claim about this
				 *  head — and it has to say so ON ITS OWN LINE. A wider window was tried
				 *  and rejected: it let a genuinely stale figure hide inside a paragraph
				 *  about an older ref, which is exactly the drift this gate exists for
				 *  (measured: mutating this head's `6,264` back to `5,832` passed a
				 *  five-line window and fails this rule). */
				const historical =
					/\b(85b2785|4649a08|756a6af|15deac3|37167390506|37098393675)\b|->|→/.test(
						line,
					);
				const at = `${file}:${index + 1}`;

				const plan = line.match(
					/(\d+) cells? (?:×|x) (\d+) frame\(s\) = (\d+) frames/,
				);
				if (plan && !historical) {
					const cells = Number(plan[1] ?? 0);
					const per = Number(plan[2] ?? 0);
					const frames = Number(plan[3] ?? 0);
					if (cells * per !== frames)
						problems.push(`${at}: ${cells} x ${per} != ${frames}`);
					if (!byCells.has(cells))
						problems.push(`${at}: ${cells} cells is no tier's plan`);
				}

				const deadline = line.match(/deadline(?::| of) ([\d,]+) s/);
				if (deadline && !historical) {
					const value = Number((deadline[1] ?? "0").replace(/,/g, ""));
					if (![...byCells.values()].some((p) => p.deadline === value))
						problems.push(`${at}: deadline ${value} s is no tier's`);
				}

				const rate = line.match(/(\d+) cells? x ([\d.]+) s = ([\d,]+) s/);
				if (rate && !historical) {
					const cells = Number(rate[1] ?? 0);
					const per = Number(rate[2] ?? 0);
					const product = Number((rate[3] ?? "0").replace(/,/g, ""));
					if (Math.abs(cells * per - product) > 1)
						problems.push(`${at}: ${cells} x ${per} != ${product}`);
				}
			});
		}
		expect(problems).toEqual([]);
	});
});
