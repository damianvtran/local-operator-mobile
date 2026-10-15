import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SOURCE CHECKS on the compact pending card (UX round 2, U11, MAJOR). There is no render
 * seam for a `uniwind` component in the Node environment, so these read the file; each
 * pins one line whose removal re-opens the defect and names the real evidence (the rig
 * geometry in the PR) that shows it. The behavioural half of the cue (when it shows, what it
 * says) is `pendingBodyCue` in `pending.test.ts`, which does run.
 *
 * The defect: in short landscape the body is a 72 pt scroller above PINNED Approve/Deny, and
 * at 200 % the destructive marker was 0 % visible and an ask's options were out of view with
 * no signal, so a user could approve a force-push without seeing "Destructive".
 */
const source = readFileSync(
	fileURLToPath(new URL("./pending-card.tsx", import.meta.url)),
	"utf8",
);

describe("compact pending card", () => {
	it("renders the destructive marker in the PINNED header in compact, not in the scroller", () => {
		// the compact branch of the body must skip the marker, and the header must render it
		expect(source).toContain("{compactBody ? null : markerNode}");
		expect(source).toContain("{compactBody ? markerNode : null}");
	});

	it("drives a cue from the body's own scroll measurements", () => {
		expect(source).toContain("pendingBodyCue(view, bodyScrolls, bodyAtEnd)");
		expect(source).toContain("SURFACE.pendingCardMore");
		expect(source).toContain("onContentSizeChange");
	});

	it("lets the body yield to the pinned header and actions, never below a readable floor", () => {
		expect(source).toContain("PENDING_BODY_MIN_PT");
		expect(source).toContain("flexShrink: 1");
	});

	it("keeps Approve/Deny and Submit OUTSIDE the scrolling body", () => {
		const body = source.slice(
			source.indexOf("SURFACE.pendingCardBody"),
			source.indexOf("Region 3"),
		);
		expect(body).not.toContain("CONTROL.pendingApprove");
		expect(body).not.toContain("CONTROL.pendingAskSubmit");
	});
});
