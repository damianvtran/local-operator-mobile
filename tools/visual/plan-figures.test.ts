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
 * WHICH SPELLINGS IT READS, so nobody has to guess (round 9, R42): the plan product
 * (`N cells × M frame(s) = K frames`), the derived deadline (`deadline: K s` and
 * `a deadline of K s`), and a rate product (`N × R s = K s` or `… = K min`, with or
 * without the word `cells`). It reads them with whitespace collapsed, so a figure the
 * formatter wrapped across two lines is still one figure.
 *
 * WHAT IT DOES NOT READ, which is a limit rather than a caveat: a figure standing alone
 * with no equation around it. The documents legitimately carry many counts that are not
 * tier plans — the README's one-phone sample (`63 cells`), a dispatcher's partial plan
 * (`400 cells`), a mean of 12 cells, a historical `256` from the rate run — so forcing
 * every `N cells` to be a tier count would fail on true statements. Nor does it read the
 * slash form (`403 cells / 1209 frames in 903.1 s`), a bare `N frames`, or prose minutes
 * that are not written as a product (`~78 minutes at 2.24 s/cell`): those are checked by
 * hand and by the rate they name. What it does catch is every figure stated IN AN
 * EQUATION, which is where six rounds of sweeps went wrong, and every derived deadline
 * wherever it is written.
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
			const text = readFileSync(join(root, file), "utf8");
			/* READ THE WHOLE FILE WITH WHITESPACE COLLAPSED, so a figure the formatter
			 *  wrapped across two lines is still one figure (round 9, R42) — and report
			 *  the line by counting the newlines before the match. A statement pinned to
			 *  another ref is history and has to say so ON ITS OWN LINE: a wider window
			 *  was tried and rejected, because it let a stale figure hide inside a
			 *  paragraph about an older ref, which is exactly the drift this gate is for
			 *  (measured: mutating this head's `6,264` back to `5,832` passed a five-line
			 *  window and fails this rule). */
			/* A FLAT COPY WITH AN INDEX MAP, so a match's line and its own source text
			 *  are recoverable exactly: flattening alone shifts every offset after the
			 *  first whitespace run, and a history check reading the wrong line turns a
			 *  historical figure into a red gate (measured before this map existed). */
			/* ONE FLAT, LINE-MAPPED COPY. Prose in `.github/workflows/*.yml` starts every
			 *  line with `# `, so a figure the formatter wrapped there is `… = #\n#  4,677 s`
			 *  — not one figure until the markers go. Each flat character remembers the
			 *  ORIGINAL line it came from, so a match can still report its line and hand
			 *  the history check the real text of every line it spans (whole lines: the ref
			 *  that makes a figure history is written beside it, not inside it). */
			const lines = text.split("\n");
			let flat = "";
			const flatLine: number[] = [];
			for (let li = 0; li < lines.length; li += 1) {
				const content = (lines[li] ?? "").replace(/^\s*#\s?/, "");
				for (const ch of content) {
					flat += ch;
					flatLine.push(li);
				}
				flat += " ";
				flatLine.push(li);
			}
			const scan = (
				re: RegExp,
				handle: (m: RegExpExecArray, where: string) => void,
			) => {
				let m = re.exec(flat);
				while (m !== null) {
					const first = flatLine[m.index] ?? 0;
					const last =
						flatLine[Math.max(0, m.index + m[0].length - 1)] ?? first;
					const source = lines.slice(first, last + 1).join(" ");
					const historical =
						/\b(85b2785|4649a08|756a6af|15deac3|37167390506|37098393675)\b|->|→/.test(
							source,
						);
					if (!historical) handle(m, `${file}:${first + 1}`);
					m = re.exec(flat);
				}
			};

			scan(
				/(\d+) cells?\s*(?:×|x)\s*(\d+) frame\(s\)\s*=\s*([\d,]+) frames/g,
				(m, where) => {
					const cells = Number(m[1] ?? 0);
					const per = Number(m[2] ?? 0);
					const frames = Number((m[3] ?? "0").replace(/,/g, ""));
					if (cells * per !== frames)
						problems.push(`${where}: ${cells} x ${per} != ${frames}`);
					if (!byCells.has(cells))
						problems.push(`${where}: ${cells} cells is no tier's plan`);
					matched.plan += 1;
				},
			);

			scan(/deadline(?::| of)\s+([\d,]+) s/g, (m, where) => {
				const value = Number((m[1] ?? "0").replace(/,/g, ""));
				if (![...byCells.values()].some((plan) => plan.deadline === value))
					problems.push(`${where}: deadline ${value} s is no tier's`);
				matched.deadline += 1;
			});

			/* The rate form is written both ways in this tree — `2088 × 2.24 s = 4,677 s`
			 *  and `696 cells x 1.25 s = 870 s`, and in minutes for the per-push bound.
			 *  It used to require the word "cells", which meant it matched NOTHING, and a
			 *  branch that matches nothing is a gate that cannot fail (review round 7,
			 *  R37: a mutation of `34.8 min` to `35.8 min` passed it). */
			scan(
				/([\d,]+)\s*(?:cells?\s*)?(?:×|x)\s*([\d.]+) s\s*=\s*([\d,.]+) (min|s)\b/g,
				(m, where) => {
					const cells = Number((m[1] ?? "0").replace(/,/g, ""));
					const per = Number(m[2] ?? 0);
					const product = Number((m[3] ?? "0").replace(/,/g, ""));
					const unit = m[4];
					const seconds = unit === "min" ? product * 60 : product;
					/* The tolerance is a ROUNDING STEP in the unit written — half a minute
					 *  for a one-decimal minute figure, two seconds for an integer one —
					 *  and not a slack: a whole minute was tried first and passed the very
					 *  mutation this branch exists to catch. */
					const slack = unit === "min" ? 30 : 2;
					if (Math.abs(cells * per - seconds) > slack)
						problems.push(
							`${where}: ${cells} x ${per} s != ${product} ${unit}`,
						);
					matched.rate += 1;
				},
			);
		}
		expect(problems).toEqual([]);
		for (const [branch, count] of Object.entries(matched)) {
			expect(`${branch}:${count > 0}`).toBe(`${branch}:true`);
		}
	});
});
