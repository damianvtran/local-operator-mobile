import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source contract only: hosted rendered QA must still measure translated labels.
const source = readFileSync(
	new URL("./thread-screen.tsx", import.meta.url),
	"utf8",
);
describe("attachment toolbar available-width layout", () => {
	it("keeps production upload wiring behind the store's account gate", () => {
		expect(source).toContain(
			"upload: (bytes) => actions.uploadAttachment(tenantId, uploadTo, bytes)",
		);
		expect(source).not.toContain("upload: (bytes) => hub.uploadAttachment");
	});
	it("draws the composer as the shared rounded field, not full-width buttons", () => {
		// Operator, TestFlight 753: a "Message" label over the field and two
		// full-width "Add image" / "Send" buttons; the agent composer's look (one
		// field, inline icon controls) replaced them. The words stay as names.
		const composer = source.slice(
			source.indexOf("<BridgeComposerField"),
			source.indexOf("</BridgeComposerDock>"),
		);
		expect(composer).toContain(
			'label={t("mobile.team_bridge.thread.message")}',
		);
		expect(composer).toContain('t("mobile.team_bridge.attachment.add")');
		expect(composer).toContain('t("mobile.team_bridge.thread.send")');
		expect(composer).toContain('t("mobile.team_bridge.thread.send_retry")');
		expect(composer).toContain(
			"images ? () => setAttachOpen(true) : undefined",
		);
		expect(composer).toContain("images.remaining() === 0");
		expect(composer).toContain("sendDisabled={!sendable}");
		expect(composer).not.toContain("<Button");
		expect(composer).not.toContain("<Textarea");
	});
	/* TestFlight 773. Source contracts for the screen, which has no Node render
	 * host here; the controls themselves are rendered in thread-chrome.test.tsx
	 * and drawer-adapter.test.tsx. */
	it("draws no hairline above the composer and pays the agent dock's clearance", () => {
		const area = source.slice(
			source.lastIndexOf(
				"<BridgeComposerDock",
				source.indexOf("testID={SURFACE.teamBridgeComposer}"),
			),
			source.indexOf("testID={SURFACE.teamBridgeComposer}"),
		);
		expect(area).not.toContain("border-t");
		expect(area).not.toContain("border-hairline");
		// TestFlight 800: the clearance and the keyboard lift moved into the dock,
		// which reads #216's keyboard store; `composer-keyboard-glass.test.tsx`
		// renders it and pins the offsets to the agent dock's rule.
		expect(area).toContain("bottomInset={insets.bottom}");
		const dock = readFileSync(
			new URL("./composer-dock.tsx", import.meta.url),
			"utf8",
		);
		expect(dock).toContain("composerOuterGap(bottomInset, keyboardVisible)");
		expect(dock).toContain("paddingHorizontal: COMPOSER_SIDE_PAD");
	});
	it("leads the thread with the drawer button, never a back arrow", () => {
		expect(source).not.toContain("BridgeBack");
		expect(source).toContain("headerLeading={<BridgeThreadDrawerButton />}");
		// A push / deep link that lands while admission is checking shows the
		// same hamburger, not the gate's default back.
		expect(source).toContain(
			"<BridgeGate headerLeading={<BridgeThreadDrawerButton />}>",
		);
	});
});
