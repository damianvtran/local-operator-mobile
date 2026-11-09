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
	it("wraps intrinsic controls rather than shrinking translated labels", () => {
		const toolbar = source.slice(
			source.indexOf(
				'<View className="flex-row',
				source.indexOf("testID={CONTROL.teamBridgeMessageInput}"),
			),
			source.indexOf("</KeyboardAvoidingView>"),
		);
		expect(toolbar).toContain("flex-wrap");
		expect(toolbar).toContain('className="max-w-full shrink-0"');
		expect(toolbar).toContain('className="max-w-full grow shrink-0"');
		expect(toolbar.indexOf("CONTROL.teamBridgeAttach")).toBeLessThan(
			toolbar.indexOf("CONTROL.teamBridgeSend"),
		);
	});
});
