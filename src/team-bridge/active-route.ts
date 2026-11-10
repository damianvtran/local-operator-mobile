const ACTIVE_BRIDGE_THREAD = /^\/team-bridge\/([^/]+)\/([^/]+)(?:\/|$)/;

/**
 * Pure route-state resolver for the currently open Team Bridge conversation or
 * draft DM. Kept free of React Native / Uniwind imports so Node unit suites can
 * test every route branch directly.
 */
export function activeBridgeRoute(
	pathname: string,
	params: {
		kind?: string | string[];
		accountId?: string | string[];
		endpointId?: string | string[];
	},
): {
	tenantId: string;
	conversationId: string;
	kind?: string;
	accountId?: string;
	endpointId?: string;
} | null {
	const match = ACTIVE_BRIDGE_THREAD.exec(pathname);
	if (!match?.[1] || !match[2]) return null;
	const one = (v: string | string[] | undefined) =>
		typeof v === "string" ? v : undefined;
	return {
		tenantId: decodeURIComponent(match[1]),
		conversationId: decodeURIComponent(match[2]),
		kind: one(params.kind),
		accountId: one(params.accountId),
		endpointId: one(params.endpointId),
	};
}
