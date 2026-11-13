import { describe, expect, it } from "vitest";
import { signInPresentation } from "./sign-in-presentation";

describe("screen-owned sign-in handoff", () => {
	it("never turns an old account latch into a new screen's navigation", () => {
		expect(
			signInPresentation({
				initiated: false,
				restoredAccount: true,
				busy: false,
				routed: false,
				state: { kind: "idle" },
			}),
		).toMatchObject({ navigate: false, state: { kind: "idle" } });
	});
	it("keeps progress visible through the idle provider render and router effect", () => {
		for (const busy of [true, false]) {
			const view = signInPresentation({
				initiated: true,
				restoredAccount: true,
				busy,
				routed: false,
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
				routed: false,
				state: failure,
			}),
		).toMatchObject({ navigate: false, state: failure });
		expect(
			signInPresentation({
				initiated: false,
				restoredAccount: false,
				busy: false,
				routed: false,
				state: { kind: "idle" },
			}).state.kind,
		).toBe("idle");
	});
	it("leaves for Home when the sign-in opened a computer, else for Computers (TestFlight 883)", () => {
		const done = {
			initiated: true,
			restoredAccount: true,
			busy: false,
			state: { kind: "idle" },
		} as const;
		expect(signInPresentation({ ...done, routed: true })).toMatchObject({
			navigate: true,
			destination: "/",
		});
		expect(signInPresentation({ ...done, routed: false })).toMatchObject({
			navigate: true,
			destination: "/tunnels",
		});
	});
});
