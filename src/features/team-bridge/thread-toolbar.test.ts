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
			source.indexOf("</KeyboardAvoidingView>"),
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
});
