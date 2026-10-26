/**
 * The fixture web build's synthetic bearer: unsigned, carrying only the
 * placeholder account id, and never a credential. Its own module, free of
 * React Native, so both the opted-in web client (`team-bridge-fixture.ts`) and
 * the Node mock hub (`tools/mock-team-bridge.ts`, strict mode) read ONE value.
 */
export const TEAM_BRIDGE_FIXTURE_TOKEN =
	"fixture.eyJzdWIiOiJhY2N0X3NlbGZfMDAwMSJ9.unsigned-not-a-credential";
