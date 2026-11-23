import type { ListSnapshot } from "@/state/list-store";

/**
 * Whether this session stream should declare `?steer_journal_order=1`
 * (local-operator #4395, docs/mobile.md "Steer journal order").
 *
 * WHY. A phone steer is painted on the live frame when it is SENT and written
 * to the journal when it is DELIVERED, rows later, so the live screen read
 * `steer, tool, tool` while `/history`, a reload and the desktop read
 * `tool, tool, user` — the operator's "messages load out of order". A declaring
 * stream gets the delivered steer at its journal slot; `HistoryWindow.accept`
 * then moves the one held row (see `settleDeliveredSteers`).
 *
 * WHY GATED ON A LIVE FRAME. The capability is only this relay's answer once a
 * live list frame carried it: capabilities restored from the warm cache are the
 * last session's (`ListSnapshot.liveFrameAt`). An older relay must see no new
 * parameter. A stream opened before the first live list frame simply does not
 * declare; it gets the legacy (send-time) order, which is what every build
 * before this one showed, and declares on its next connect.
 */
export const steerJournalOrderDeclared = (
	list: Pick<ListSnapshot, "capabilities" | "liveFrameAt">,
): boolean =>
	list.liveFrameAt !== null &&
	list.capabilities.steer_journal_order?.available === true;
