/** Test-only inputs shared by the opted-in web seam and its loopback hub.
 * A flow isolates review runs without deleting another run's dismissal record.
 * Tokens identify synthetic worlds only; they cannot authorize a real hub.
 */

const VALID_CASE = /^[a-z_-]+$/;
const VALID_FLOW = /^[a-z][a-z0-9_-]*$/;

export function fixtureIdentity(flow: string, account: string): string {
	return `fixture.${btoa(JSON.stringify({ sub: `fixture_${flow}_${account}` }))}.unsigned-not-a-credential`;
}

export function fixtureOptions(search: string) {
	const query = new URLSearchParams(search);
	const scenario = query.get("tb-fixture");
	if (!scenario || !VALID_CASE.test(scenario)) return null;
	const flow = query.get("tb-flow");
	const isolated = flow !== null && VALID_FLOW.test(flow);
	const account = query.get("tb-account") === "b" ? "b" : "a";
	const org = query.get("tb-org") === "two" ? "two" : "one";
	const world = isolated ? `${scenario}~${flow}~${account}~${org}` : scenario;
	const locale = query.get("tb-locale");
	const scale = query.get("tb-scale");
	const theme = query.get("tb-theme");
	return {
		world,
		token:
			scenario === "signed_out"
				? null
				: isolated
					? fixtureIdentity(flow, account)
					: undefined,
		locale:
			locale === "hi" || locale === "ur" || locale === "en" ? locale : "en",
		scale: scale === "200" ? ("200" as const) : ("100" as const),
		theme: theme === "dark" ? ("dark" as const) : ("light" as const),
	};
}

export function fixtureWorld(world: string) {
	const [scenario = "", flow, account, org] = world.split("~");
	return {
		scenario,
		token:
			flow && (account === "a" || account === "b")
				? fixtureIdentity(flow, account)
				: undefined,
		secondOrg: org === "two",
	};
}
