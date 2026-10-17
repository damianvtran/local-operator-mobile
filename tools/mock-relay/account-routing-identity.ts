/** Test transport identities only. Never broaden the app's route validator.
 * .local is an explicit dedicated-CI proof transport, not a hostname option.
 * The nonce/slot must match the host AND cookie so a sibling cannot borrow it.
 */
export type PolicyTransport = "localhost" | "ci-native-mdns";
const HOST = /^loh12-([a-f0-9]{32})-([ab])\.(localhost|local)$/;
const COOKIE = /^loh12_fixture_([a-f0-9]{32})_([ab])$/;
const NONCE = /^[a-f0-9]{32}$/;

export function requirePolicyTransport(
	value: unknown = "localhost",
): PolicyTransport {
	if (value !== "localhost" && value !== "ci-native-mdns")
		throw new Error("unknown canonical fixture transport");
	return value;
}

export function assertDedicatedNativeCI(env: NodeJS.ProcessEnv) {
	if (
		env.GITHUB_ACTIONS !== "true" ||
		env.RUNNER_ENVIRONMENT !== "github-hosted" ||
		env.RUNNER_OS !== "macOS" ||
		env.LOH12_NATIVE_PROOF_ADMITTED !== "1"
	)
		throw new Error(
			"native mDNS proof requires explicit dedicated GitHub-hosted macOS admission",
		);
}

export function policyIdentity(
	nonce: string,
	slot: "a" | "b",
	transport: PolicyTransport = "localhost",
) {
	requirePolicyTransport(transport);
	if (!NONCE.test(nonce) || (slot !== "a" && slot !== "b"))
		throw new Error("invalid owned fixture nonce/slot");
	return {
		hostname: `loh12-${nonce}-${slot}.${transport === "localhost" ? "localhost" : "local"}`,
		cookieName: `loh12_fixture_${nonce}_${slot}`,
		transport,
	};
}

export function assertPolicyFixtureIdentity(
	hostname: string,
	cookieName: string,
	transport: PolicyTransport = "localhost",
) {
	requirePolicyTransport(transport);
	const host = HOST.exec(hostname);
	const cookie = COOKIE.exec(cookieName);
	if (
		!host ||
		!cookie ||
		host[1] !== cookie[1] ||
		host[2] !== cookie[2] ||
		host[3] !== (transport === "localhost" ? "localhost" : "local")
	)
		throw new Error(
			"canonical fixture requires a unique per-run matched nonce/slot host and cookie namespace",
		);
}
