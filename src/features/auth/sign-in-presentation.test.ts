import { describe, expect, it } from "vitest";
import { signInPresentation } from "./sign-in-presentation";

describe("screen-owned sign-in handoff", () => {
	it("never turns an old account latch into a new screen's navigation", () => {
		expect(
			signInPresentation({
				initiated: false,
				restoredAccount: true,
				busy: false,
				state: { kind: "idle" },
			}),
		).toEqual({ navigate: false, state: { kind: "idle" } });
	});
	it("keeps progress visible through the idle provider render and router effect", () => {
		for (const busy of [true, false]) {
			const view = signInPresentation({
				initiated: true,
				restoredAccount: true,
				busy,
				state: { kind: "idle" },
			});
			expect(view.state.kind).toBe("exchanging");
			expect(view.navigate).toBe(!busy);
		}
	});
	it("does not hide retryable failures or ordinary first-run buttons", () => {
		const failure = { kind: "failed", detail: "[redacted]" } as const;
		expect(
			signInPresentation({
				initiated: true,
				restoredAccount: true,
				busy: false,
				state: failure,
			}),
		).toEqual({ navigate: false, state: failure });
		expect(
			signInPresentation({
				initiated: false,
				restoredAccount: false,
				busy: false,
				state: { kind: "idle" },
			}).state.kind,
		).toBe("idle");
	});
});
