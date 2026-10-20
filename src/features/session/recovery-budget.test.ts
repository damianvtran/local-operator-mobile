import { describe, expect, it } from "vitest";
import { recoveryBudget } from "./recovery-budget";

const measured = {
	column: 323,
	before: 0,
	after: 4,
	composer: 125,
	header: 71.1875,
	controls: 56,
};
describe("pending recovery fixed-region allocation", () => {
	it("fits the actual QA landscape geometry without inventing another viewport", () => {
		expect(recoveryBudget(measured)).toEqual({
			kind: "fit",
			card: 190,
			body: 56.8125,
		});
	});
	it("admits exact floor and reports impossible immutable floors honestly", () => {
		expect(recoveryBudget({ ...measured, column: 322.1875 })).toEqual({
			kind: "fit",
			card: 189.1875,
			body: 56,
		});
		expect(recoveryBudget({ ...measured, column: 322 })).toEqual({
			kind: "infeasible",
			body: 56,
		});
	});
	it("does not infer measurements from the pending wrapper or window", () => {
		expect(recoveryBudget({})).toEqual({ kind: "unmeasured", body: 56 });
		expect(recoveryBudget({ ...measured, controls: undefined }).kind).toBe(
			"unmeasured",
		);
		expect(recoveryBudget({ ...measured, column: Number.NaN }).kind).toBe(
			"unmeasured",
		);
	});
	it("recomputes on actual resizing, fixed sibling growth and taller pinned errors", () => {
		expect(recoveryBudget({ ...measured, column: 400 }).body).toBe(133.8125);
		expect(recoveryBudget({ ...measured, before: 10 }).kind).toBe("infeasible");
		expect(recoveryBudget({ ...measured, controls: 100 }).kind).toBe(
			"infeasible",
		);
		expect(
			recoveryBudget({ ...measured, column: 600, before: 30, composer: 180 })
				.kind,
		).toBe("fit");
	});
});
