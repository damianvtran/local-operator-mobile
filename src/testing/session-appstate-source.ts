/* Source-wiring tests must select the stream owner's listener, not whichever
 * AppState listener appears first. Warm-view bookkeeping legitimately registers
 * separately. Use the reconnect action as ownership, independently of the clock
 * and history guards under test, and fail closed if ownership is ambiguous. */
const APPSTATE_HANDLER =
	/AppState\.addEventListener\("change", \(state\) => \{[\s\S]*?\n\t\t\}\);/g;

export function sessionResumeHandler(source: string): string {
	const handlers = [...source.matchAll(APPSTATE_HANDLER)].filter(([handler]) =>
		handler.includes("reconnectRef.current();"),
	);
	const firstHandler = handlers[0];
	if (!firstHandler || handlers.length !== 1) {
		throw new Error(
			`Expected one stream-owning AppState listener, found ${handlers.length}`,
		);
	}
	return firstHandler[0];
}
