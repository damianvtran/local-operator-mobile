import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LABEL_OFF_SCALE = /pb-0\.5/;

/**
 * SOURCE CHECK on the subagent detail screen's "prompt" and "result" labels.
 *
 * They carried `pb-0.5` (2 pt, off `space.scale`) from the session view's first commit,
 * but the S6 loaded state was never rendered by the audit (the fixture's job id did not
 * resolve), so the check had never measured them. Once S6 loaded, CI's U-42 reported 48
 * FAIL rows (2 nodes x 24 cells) and nothing else. The fix is the on-scale `pb-1`; no
 * exemption and no rule change. The discriminating proof is that audit row set on the
 * real build; this test stops the value returning.
 */
describe("subagent detail labels", () => {
	it("keep the label padding on the spacing scale", () => {
		const source = readFileSync(
			fileURLToPath(
				new URL(
					"../../../app/(app)/session/[id]/agent/[jobId].tsx",
					import.meta.url,
				),
			),
			"utf8",
		);
		expect(source).not.toMatch(LABEL_OFF_SCALE);
	});
});
