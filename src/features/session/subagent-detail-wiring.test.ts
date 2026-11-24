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
/** The detail read moved into `useSubagentTranscript` with the transcript's
 *  own reads; `missing` is derived there now, by the same two arms. */
const HOOK = readFileSync(
	fileURLToPath(new URL("./use-subagent-transcript.ts", import.meta.url)),
	"utf8",
);

describe("subagent detail screen", () => {
	it("hands the badge the screen's own missing flag", () => {
		expect(SOURCE).toContain("subagentBadge(detail, missing)");
	});

	it("derives missing from the settled fetch, both an empty answer and a failure", () => {
		expect(SOURCE).toContain("const { detail, missing } = view;");
		expect(HOOK).toContain("setMissing(loaded === null)");
		expect(HOOK).toContain("if (!cancelled) setMissing(true)");
	});
});
