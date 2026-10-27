import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Settings renders the route's refusal where its switcher can leave the reader
 * (PR #122 QA round 2, Q6; UX U11).
 *
 * The switcher closes on a failed pick so the reason behind it is readable. From
 * Settings there was no reason behind it — only "Not connected", with the refusal
 * painted on the hidden Home and "Last error" a screen and a half below. The
 * provider half (Try again re-runs the PICKED computer) is proved against the mock
 * control plane in `connection-provider.test.ts`; the sheet half (it closes) in
 * `computer-switcher-sheet.test.ts`. This pins the screen half.
 *
 * Asserted over the SOURCE, for the reason `tags-wiring.test.ts` records: the
 * screen reaches `uniwind` through `@/ui`, which the Node test environment cannot
 * import. The frames are the design and QA rounds' job.
 */
const SETTINGS = readFileSync(
	fileURLToPath(new URL("./settings.tsx", import.meta.url)),
	"utf8",
);
const SURFACE_BLOCK =
	/\{refusal \? \(\s*<RefusalSurface([\s\S]*?)\/>\s*\) : null\}/;

describe("Settings shows a refused switch where the reader is (Q6/U11)", () => {
	const block = SURFACE_BLOCK.exec(SETTINGS);

	it("renders the shared refusal surface whenever the route is refused", () => {
		expect(block).not.toBeNull();
		for (const prop of [
			"kind={refusal.kind}",
			"subject={refusal.subject}",
			"detail={refusal.detail}",
			"remedy={refusal.remedy}",
		])
			expect(block?.[1]).toContain(prop);
	});

	it("wires every remedy the surface can offer, Try again to the provider's retry", () => {
		expect(block?.[1]).toContain("onRetry={() => void retry()}");
		expect(block?.[1]).toContain("onSignIn={() => void signInWithRadient()}");
		expect(block?.[1]).toContain("onOpenConsole=");
		expect(block?.[1]).toContain("onUseAnotherAddress=");
	});

	it("sits above the fold: under Status, before the computer list and Switch computer", () => {
		const at = (needle: string) => SETTINGS.indexOf(needle);
		const surface = at("<RefusalSurface");
		expect(at("<ConnectionPill")).toBeLessThan(surface);
		expect(surface).toBeLessThan(at("computerRowIds(computer.hostname).row"));
		expect(surface).toBeLessThan(at("CONTROL.settingsSwitchComputer"));
	});

	it("sends Add a computer to the set-up paths, not the bare list (U12)", () => {
		expect(SETTINGS).toContain("router.push(ADD_COMPUTER_HREF)");
	});
});
