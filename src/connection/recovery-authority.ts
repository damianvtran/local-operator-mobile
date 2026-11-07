/** Recovery trusts a server-authenticated account, never an email or locally
 * decoded JWT. Keep the endpoint fixed: route configuration must not turn the
 * current bearer into a credential sent to a relay or redirected origin. */
import { RADIENT_HOST_PATTERN, type RouteProfile } from "./profile";

const CONTROL_PLANE = "https://api.radienthq.com";
export type RecoveryOwner = Readonly<{
	accountId: string;
	tenantId: string;
}>;

const object = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
const identifier = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0 && value.length <= 256;

/** A proof is deliberately not persisted as permission to recover offline.
 * Every admission must obtain a fresh authenticated response. Network/auth/schema
 * failures disable recovery, not ordinary sign-in or the live relay connection. */
export async function proveRecoveryAuthority(
	accessToken: string,
	options: {
		fetcher?: typeof fetch;
		isCurrent: () => boolean;
	},
): Promise<RecoveryOwner | null> {
	if (!accessToken || !options.isCurrent()) return null;
	const controller = new AbortController();
	// Match the relay HTTP client's normal 20-second deadline. Recovery must not
	// wait indefinitely, nor time out sooner merely because native UI is settling.
	const timeout = setTimeout(() => controller.abort(), 20_000);
	try {
		const response = await (options.fetcher ?? fetch)(
			`${CONTROL_PLANE}/v1/me`,
			{
				// Expo's native fetch does not forward RequestInit.cache to URLSession.
				// HTTP directives are therefore mandatory, not redundant browser hints.
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Cache-Control": "no-store, no-cache",
					Pragma: "no-cache",
				},
				cache: "no-store",
				redirect: "error",
				credentials: "omit",
				signal: controller.signal,
			},
		);
		if (!response.ok || !options.isCurrent()) return null;
		const result = object(object(await response.json())?.result);
		const identity = object(result?.identity);
		const account = object(result?.account);
		if (
			!options.isCurrent() ||
			!identifier(account?.id) ||
			!identifier(account?.tenant_id) ||
			identity?.account_id !== account.id
		)
			return null;
		return Object.freeze({
			accountId: account.id,
			tenantId: account.tenant_id,
		});
	} catch {
		// Never log a response body: the identity document contains personal data.
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

/** Personal-owner only. A future organization selector needs its own trusted
 * authorization contract; memberships and client-provided org labels are not it.
 * Bind both the opaque tunnel and exact relay origin so moving a computer/backend
 * cannot reveal the previous backend's draft at an otherwise identical account. */
export function recoveryAuthorityScope(
	owner: RecoveryOwner,
	route: RouteProfile & { orgId?: string },
): string | null {
	if (
		route.mode !== "radient" ||
		route.orgId !== undefined ||
		Object.keys(route).some(
			(key) => !["mode", "hostname", "tunnelId"].includes(key),
		) ||
		!identifier(route.tunnelId) ||
		!RADIENT_HOST_PATTERN.test(route.hostname) ||
		!route.hostname.endsWith("-lop.radienthq.com")
	)
		return null;
	try {
		const relay = new URL(`https://${route.hostname}`);
		if (relay.protocol !== "https:" || relay.username || relay.password)
			return null;
		return JSON.stringify([
			1,
			CONTROL_PLANE,
			owner.accountId,
			owner.tenantId,
			"personal-owner",
			route.tunnelId,
			relay.origin,
			"local-operator",
		]);
	} catch {
		return null;
	}
}
