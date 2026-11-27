import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SOURCE CHECK on the subagent detail screen's badge call site.
 *
 * `subagentBadge` is tested on its own (`subagent-status.test.ts`), but the
 * screen decides what it is given. Passing a constant `false` in place of the
 * screen's `missing` flag brings audit D6 straight back — "no longer
 * available" under a `loading` badge — with every other test green (agent
 * review round 1, R1). This pins the argument.
 */
const SOURCE = readFileSync(
	fileURLToPath(
		new URL(
			"../../../app/(app)/session/[id]/agent/[jobId].tsx",
			import.meta.url,
		),
	),
	"utf8",
);

describe("subagent detail screen", () => {
	it("hands the badge the screen's own missing flag", () => {
		expect(SOURCE).toContain("subagentBadge(detail, missing)");
	});

	/* How `missing` is DERIVED (an empty answer and a failed read) is pinned by
	 * behaviour, not by source text: `subagent-screen.test.tsx`, "says the child
	 * is no longer available, under an unavailable badge" (agent review round 1,
	 * R1-n2 — a literal on a variable name broke on a rename and proved nothing). */
});
