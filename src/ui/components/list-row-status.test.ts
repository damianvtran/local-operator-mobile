import { describe, expect, it } from "vitest";

import { STATE_MARKER, SURFACE } from "@/ui/a11y";
import { listRowStatus } from "./list-row-status";

const idle = {
	pending: false,
	attentionWord: "approval" as const,
	remoteUnreachable: false,
	ended: false,
	degraded: false,
};

describe("observable row receipts", () => {
	it("marks only the receipt word that renders", () => {
		expect(listRowStatus(idle)).toEqual({ word: null, testID: undefined });
		expect(listRowStatus({ ...idle, ended: true, degraded: true })).toEqual({
			word: "ended",
			testID: STATE_MARKER.sidebar.ended,
		});
		expect(listRowStatus({ ...idle, degraded: true })).toEqual({
			word: "not answering",
			testID: STATE_MARKER.sidebar["degraded-row"],
		});
	});
	it("does not affirm a receipt hidden by attention or unreachable state", () => {
		expect(
			listRowStatus({ ...idle, pending: true, ended: true, degraded: true }),
		).toEqual({ word: "approval", testID: undefined });
		expect(
			listRowStatus({
				...idle,
				pending: true,
				attentionWord: "question",
				remoteUnreachable: true,
				ended: true,
			}),
		).toEqual({ word: "question", testID: undefined });
		expect(
			listRowStatus({ ...idle, remoteUnreachable: true, degraded: true }),
		).toEqual({
			word: "not reachable",
			testID: SURFACE.sessionRemoteUnreachable,
		});
	});
});
