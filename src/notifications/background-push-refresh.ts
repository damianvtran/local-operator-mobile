import type { createWarmSync } from "@/state/warm-sync";
import {
	attentionFromTaskPayload,
	type BackgroundClearDeps,
	BackgroundResult,
	BUDGET_MS,
	runBackgroundClear,
} from "./background-clear";
import { conversationPushFromData, pushDataObject } from "./payload";

/** The existing task's two sequential jobs, not another native task. Clearing
 * badge/tray comes first; warming gets only the remainder of that SAME 25 s.
 * No provider/credentials are opened here: the coordinator accepts only an
 * already-admitted warm route. A cold/locked headless wake remains NoData. */
export async function runBackgroundPushRefresh(
	payload: unknown,
	deps: BackgroundClearDeps,
	sync: Pick<ReturnType<typeof createWarmSync>, "pushed">,
	budgetMs = BUDGET_MS,
): Promise<BackgroundResult> {
	const deadline = Date.now() + budgetMs;
	let cleared: BackgroundResult = BackgroundResult.NoData;
	try {
		const attention = attentionFromTaskPayload(payload);
		if (attention) {
			cleared = await runBackgroundClear(payload, deps, budgetMs);
			const refreshed = await sync.pushed(
				{
					reason: "attention",
					computer: attention.computer,
				},
				Math.max(0, deadline - Date.now()),
			);
			return refreshed ? BackgroundResult.NewData : cleared;
		}
		const data =
			payload && typeof payload === "object"
				? (payload as Record<string, unknown>).data
				: null;
		const record = pushDataObject(data);
		const completion = conversationPushFromData(data);
		if (record?.type !== "completion" || !completion?.computer)
			return BackgroundResult.NoData;
		const refreshed = await sync.pushed(
			{
				reason: "completion",
				computer: completion.computer,
				conversation: completion.conversation,
			},
			Math.max(0, deadline - Date.now()),
		);
		return refreshed ? BackgroundResult.NewData : BackgroundResult.NoData;
	} catch {
		// Best effort must never turn a locked wake into an auth/refusal surface.
		return cleared;
	}
}
