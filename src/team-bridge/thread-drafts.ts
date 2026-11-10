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
 */

const drafts = new Map<string, string>();
const MAX_DRAFTS = 64;

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
	// Refresh insertion order and bound total retained entries.
	drafts.delete(key);
	drafts.set(key, text);
	if (drafts.size > MAX_DRAFTS) {
		const oldest = drafts.keys().next().value;
		if (oldest !== undefined) drafts.delete(oldest);
	}
}

export function clearTeamBridgeDrafts(): void {
	drafts.clear();
}
