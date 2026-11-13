import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Sherman's Settings showed "Not signed in with Radient" on an account card with
 * no onPress, although it reads as the way to sign in (relayed by Aida). Node
 * cannot import the real Settings screen's native styling stack, so — as in
 * `settings-sign-out-wiring.test.ts` — the actual wiring is pinned here; the
 * pressed card, the browser hand-off and the landing must still be exercised on
 * a real build, not inferred from these source assertions. */
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");
const settings = read("./settings.tsx");
const welcome = read("../auth/welcome.tsx");

const accountSection = settings.slice(
	settings.indexOf(
		"{/* ---------------------------------------------------------- account */}",
	),
	settings.indexOf(
		"{/* -------------------------------------------------------- connection */}",
	),
);

describe("the signed-out account card starts Radient sign-in", () => {
	it("is a button exactly when it says it is signed out; signed in stays a plain Card", () => {
		expect(settings).toContain(
			"const accountSignedOut = accountLabel == null;",
		);
		expect(accountSection).toContain("{accountSignedOut ? (");
		expect(accountSection).toContain("<Card>{accountBody}</Card>");
	});
	it("makes the WHOLE card the pressable, with role button, a label and a hint", () => {
		const pressable = accountSection.slice(
			accountSection.indexOf("<Pressable"),
			accountSection.indexOf("</Pressable>"),
		);
		expect(pressable).toContain("accessibilityRole={ROLE.button}");
		expect(pressable).toContain(
			'accessibilityLabel={t("mobile.signin.start")}',
		);
		expect(pressable).toContain(
			'accessibilityHint={t("mobile.settings.account.not_signed_in")}',
		);
		expect(pressable).toContain("onPress={startSignIn}");
		expect(pressable).toContain("disabled={busy}");
		expect(pressable).toContain("testID={CONTROL.settingsAccountSignIn}");
		/* The card body is INSIDE the pressable, so any point on it is the target. */
		expect(pressable).toContain("{accountBody}");
	});
	it("is drawn in the nav-card family with a visible label and a direction-aware chevron", () => {
		expect(accountSection).toContain("className={navCardClasses({ pressed })}");
		expect(accountSection).toContain(
			"style={{ minHeight: NAV_CARD_MIN_HEIGHT }}",
		);
		expect(accountSection).toContain(
			'<Text className="text-label text-accent" {...composedDir}> {t("mobile.signin.start")} </Text>',
		);
		expect(accountSection).toContain(
			"{rtl ? ( <ChevronLeft size={18} color={chevronInk} aria-hidden /> ) : ( <ChevronRight size={18} color={chevronInk} aria-hidden /> )}",
		);
	});
});

describe("it is the SAME sign-in as Welcome, not a fork", () => {
	it("calls the provider's signInWithRadient, marking this screen's own attempt", () => {
		expect(settings).toContain(
			"const startSignIn = useCallback(() => { setSignInInitiated(true); void signInWithRadient(); }, [signInWithRadient]);",
		);
		expect(welcome).toContain(
			"const start = () => { setInitiated(true); void signInWithRadient(); };",
		);
		/* No second OAuth path: the radient-oauth module is the provider's. */
		expect(settings).not.toContain("@/connection/radient-oauth");
		expect(settings).not.toContain("openUsualComputer(");
	});
	it("lands through signInPresentation with the same inputs and the same effect", () => {
		expect(settings).toContain(
			"const signInLanding = signInPresentation({ initiated: signInInitiated, restoredAccount, busy, routed: route !== null, state: signInState, });",
		);
		expect(welcome).toContain(
			"const presentation = signInPresentation({ initiated, restoredAccount, busy, routed, state: signInState, });",
		);
		expect(settings).toContain(
			"if (signInLanding.navigate) router.replace(signInLanding.destination);",
		);
		expect(welcome).toContain(
			"if (presentation.navigate) router.replace(presentation.destination);",
		);
	});
	it("shows the same progress/failure panel Welcome shows, for its own attempt only", () => {
		expect(settings).toContain(
			"{signInInitiated ? ( <SignInPanel state={signInLanding.state} diagnostics={signInDiagnostics} onStart={startSignIn} onUseAddress={() => undefined} /> ) : null}",
		);
	});
});
