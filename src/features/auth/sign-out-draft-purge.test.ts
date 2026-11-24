/**
 * The sign-out purge of typed ask answers is REGISTERED (review r1 F8 / r2-m4).
 *
 * WHY THIS EXISTS. An answer typed into the ask sheet is held in memory for the
 * app run (Ben, a-5712: "Keep it"), and the one moment it must not survive is the
 * account boundary — `connection-provider.tsx` retires the warm cache there, and
 * the draft store goes with it. The wiring is one module-scope registration whose
 * removal changes nothing the store itself would notice, so this pins it.
 *
 * Asserted over the SOURCE, deliberately: the behavioural home is
 * `connection-provider.test.ts`, which is red on origin/main for its own reasons
 * (its "usable list progress recovery" cases time out on real HTTP), so a pin
 * there would be invisible. `ask-drafts.test.ts` proves the function the
 * registration calls does clear the store.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	fileURLToPath(new URL("./connection-provider.tsx", import.meta.url)),
	"utf8",
);

describe("the account boundary", () => {
	it("forgets every typed ask answer when the account is retired", () => {
		expect(SOURCE).toContain(
			"registerStartupAuthorizationCleanup(async () => forgetAskDrafts())",
		);
	});

	it("imports the purge from the draft store rather than re-implementing it", () => {
		expect(SOURCE).toContain(
			'import { forgetAskDrafts } from "@/features/session/ask-drafts";',
		);
	});
});
