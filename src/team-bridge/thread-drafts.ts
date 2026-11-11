/**
 * Lightweight account-scoped in-memory text draft map for Team Bridge threads.
 *
 * WHY THIS EXISTS. Switching channels from the workspace drawer uses
 * `router.replace`, which unmounts the active `ThreadContent` instance. Without
 * an external draft map, an unsent reply typed in `#general` was lost the
 * moment the reader glanced at `#ops` and came back.
 *
 * PRIVACY & ACCOUNT BOUNDARY (`docs/design/native-interaction-guidelines.md`):
 * - Every entry is keyed by `[accountId, tenantId, routeKey]`, so two accounts
 *   or two organizations can never read or overwrite each other's drafts.
 * - `clearTeamBridgeDrafts()` runs on `retire()` and `reset()` in the Team
 *   Bridge store, wiping every entry synchronously on sign-out or account
 *   replacement so nothing survives an authentication boundary in memory.
 * - Intentionally in-memory only (not described as restart-safe).
 *
 * NO SIZE CAP (review R1-7). Entries exist only for threads with unsent text:
 * writing an empty draft (send clears the composer) deletes the entry, and the
 * sign-out/reset wipe empties the map. What remains is bounded by what one
 * person has typed and not sent in one signed-in session — an unmeasured
 * eviction count would only ever discard someone's unsent words.
 */

const drafts = new Map<string, string>();

export function teamBridgeDraftKey(input: {
	accountId: string | null;
	tenantId: string;
	routeId: string;
	kind?: string;
	targetAccountId?: string;
	endpointId?: string;
}): string | null {
	if (!input.accountId || !input.tenantId || !input.routeId) return null;
	return JSON.stringify([
		input.accountId,
		input.tenantId,
		input.routeId,
		input.routeId === "new" ? (input.kind ?? "") : "",
		input.routeId === "new" ? (input.targetAccountId ?? "") : "",
		input.routeId === "new" ? (input.endpointId ?? "") : "",
	]);
}

export function readTeamBridgeDraft(key: string | null): string {
	if (!key) return "";
	return drafts.get(key) ?? "";
}

export function writeTeamBridgeDraft(key: string | null, text: string): void {
	if (!key) return;
	if (!text) {
		drafts.delete(key);
		return;
	}
	drafts.set(key, text);
}

export function clearTeamBridgeDrafts(): void {
	drafts.clear();
}
