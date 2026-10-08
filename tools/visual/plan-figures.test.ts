import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
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

/**
 * A port nobody else holds, asked of the kernel rather than assumed (review round 6,
 * R33): a hardcoded 4493 is how this gate flakes on a fleet host where a sibling
 * session's relay already has it. Bound and released, then handed to the relay — the
 * gap between the two is one syscall wide and the failure mode is a red gate with the
 * relay's own error in it, not a wrong number.
 */
async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port =
				typeof address === "object" && address !== null ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}

let relayUrl = "";

/** Wait until the relay ANSWERS, rather than sleeping and hoping (R33). Its replies
 *  are authenticated and a bare `GET /` is a 404 or a 401 — either one proves the
 *  socket is serving, which is all the plan needs. */
async function waitForRelay(url: string, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	for (;;) {
		try {
			await fetch(url, { method: "GET" });
			return true;
		} catch {
			if (Date.now() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

beforeAll(async () => {
	/* `spawn`, not `spawnSync`: the relay has to KEEP RUNNING while the plans are
	 *  read, so the synchronous call would block on it for its whole timeout. */
	const port = await freePort();
	relayUrl = `http://127.0.0.1:${port}`;
	relay = spawn(
		"node",
		["tools/mock-relay/relay.ts", "--scenario", "idle", "--port", String(port)],
		{ cwd: root, detached: true, stdio: "ignore" },
	);
	relay.unref();
	if (!(await waitForRelay(relayUrl, 30000))) {
		throw new Error(`the mock relay never answered on ${relayUrl}`);
	}
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
		/* Every branch must MATCH something, or it is a rule that cannot fire. The
		 *  counts are asserted at the end of the sweep rather than per file. */
		const matched = { plan: 0, deadline: 0, rate: 0 };
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
					matched.plan += 1;
				}

				const deadline = line.match(/deadline(?::| of) ([\d,]+) s/);
				if (deadline && !historical) {
					const value = Number((deadline[1] ?? "0").replace(/,/g, ""));
					if (![...byCells.values()].some((p) => p.deadline === value))
						problems.push(`${at}: deadline ${value} s is no tier's`);
					matched.deadline += 1;
				}

				/* The rate form is written both ways in this tree — `2088 x 2.24 s =
				 *  4,677 s` and `696 cells x 1.25 s = 870 s` — so the branch matches
				 *  either. It used to require the word "cells", which meant it matched
				 *  NOTHING, and a branch that matches nothing is a gate that cannot fail
				 *  (review round 7, R37: a mutation of `34.8 min` to `35.8 min` passed).
				 *  `matched` below is what stops that happening again. */
				const rate = line.match(
					/([\d,]+) (?:cells? )?x ([\d.]+) s = ([\d,.]+) (min|s)\b/,
				);
				if (rate && !historical) {
					const cells = Number((rate[1] ?? "0").replace(/,/g, ""));
					const per = Number(rate[2] ?? 0);
					const product = Number((rate[3] ?? "0").replace(/,/g, ""));
					/* Seconds are the unit everywhere but the per-push bound, which
					 *  states its sample in minutes. The tolerance is a ROUNDING STEP in
					 *  the unit written — half a minute for a one-decimal minute figure,
					 *  two seconds for an integer one — and not a slack: a whole minute
					 *  was tried first and passed the very mutation this branch exists to
					 *  catch (`34.8 min` -> `35.8 min`, which is 60 s of drift). */
					const seconds = rate[4] === "min" ? product * 60 : product;
					const slack = rate[4] === "min" ? 30 : 2;
					if (Math.abs(cells * per - seconds) > slack)
						problems.push(`${at}: ${cells} x ${per} s != ${product} ${rate[4]}`);
					matched.rate += 1;
				}
			});
		}
		expect(problems).toEqual([]);
		for (const [branch, count] of Object.entries(matched)) {
			expect(`${branch}:${count > 0}`).toBe(`${branch}:true`);
		}
	});
});
