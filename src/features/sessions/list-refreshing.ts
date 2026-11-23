/**
 * Whether the conversations pane's pull-to-refresh spinner shows.
 *
 * WHY NOT `busy` ALONE. The provider's `busy` means "the attempt that opened
 * the route has not RETURNED", and `goLive` publishes the route live (header
 * chip ✓, list stream running) before it awaits startup admission. While
 * admission is held, `refreshing={busy}` kept the drawer's spinner turning over
 * a list that was already loading — the same stuck state as Home's
 * "Connecting to Mac…" splash (PR #327, review m1). So the spinner follows the
 * same live fact Home's recovery line reads (`home-recovery.ts`): an attempt in
 * flight spins only while there is no live route to show instead.
 */
export function listRefreshing(input: {
	/** The provider's `busy`: a connection attempt has not returned yet. */
	busy: boolean;
	/** A route is selected and its client is published — the chip's check. */
	connected: boolean;
}): boolean {
	return input.busy && !input.connected;
}
