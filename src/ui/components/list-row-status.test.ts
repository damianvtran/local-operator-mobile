import { describe, expect, it } from "vitest";

import { renderFor } from "@/i18n";
import { STATE_MARKER, SURFACE } from "@/ui/a11y";
import { listRowStatus, ROW_STATUS_KEY } from "./list-row-status";

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
			word: "not_answering",
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
			word: "not_reachable",
			testID: SURFACE.sessionRemoteUnreachable,
		});
	});
});

describe("the painted status word (O3-c)", () => {
	it("is keyed, and its English is the word the row painted before", () => {
		/* The projection now returns identifiers; `ListRow` paints
		 *  `t(ROW_STATUS_KEY[word])`. English must not move a byte, so each key's
		 *  English is pinned to the literal the row rendered raw on f5498d3c. */
		const before = {
			approval: "approval",
			question: "question",
			not_reachable: "not reachable",
			ended: "ended",
			not_answering: "not answering",
		} as const;
		for (const [word, english] of Object.entries(before)) {
			expect(
				renderFor(ROW_STATUS_KEY[word as keyof typeof before], {}, "en"),
			).toBe(english);
		}
	});
});
