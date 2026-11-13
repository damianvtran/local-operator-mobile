import { readFileSync } from "node:fs";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { DirectionProvider, useComposedDir } from "@/ui/direction";
import { TunnelPaths } from "./tunnel-paths";

/**
 * M3 S1 design review D2 (MAJOR): in Urdu, four S1 values START with the Latin
 * product name — `Radient کے ساتھ سائن ان کریں`, `Radient سے جڑیں`,
 * `Radient اکاؤنٹ درکار ہے۔ …`, `Radient کے پاس ٹنل ہے — {status}۔` — so
 * react-native-web's default `dir="auto"` resolved them LEFT-TO-RIGHT on an RTL
 * page: the postposition read ahead of the noun it governs and the card body sat
 * ragged-right (frame `D2-ur-bidi-sheet.png`). The repo's cure for exactly this
 * is `useComposedDir()` (`src/ui/direction.tsx`), spread onto the `Text` that
 * renders the value; the Button gets the same opt-in the `SectionHeader` already
 * has (`labelDir`). The catalogue is correct and unchanged.
 *
 * RENDERED where Node can render (Button, TunnelPaths: `renderToStaticMarkup`
 * under the real `DirectionProvider`, the pattern of `section-header.test.ts`);
 * SOURCE-LEVEL for the two screens whose native stack Node cannot import
 * (`composed-dir-sites.test.ts` pattern). Real-path QA owns the device frame.
 */
/* `@/ui/appearance` reaches native token plumbing Node cannot parse; the colour
 * is irrelevant to the direction under test (same stub as computers-add-wait). */
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));

const STARTS_LATIN = /^[A-Za-z]/;
const ICU_SLOT = /\{[^}]*\}/g;
const FIRST_LETTER = /\p{L}/u;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;

/** The S1 keys whose Urdu value begins with a Latin token and is rendered as
 *  visible text. `mobile.computers.row.a11y*` also begin with a `{name}` slot, but
 *  they are screen-reader labels (no paragraph is laid out), so they are not here. */
const LATIN_INITIAL_UR_KEYS = [
	"mobile.computers.paths.radient_body",
	"mobile.computers.paths.radient_title",
	"mobile.computers.wait.tunnel_status",
	"mobile.signin.start",
] as const;

/** M3 S2a (#243 QA Q-02): the same defect in values that PREDATE S1, on the
 *  refusal paths. No catalogue change; the cure is again the page's direction at
 *  the render site. The three console helps all render through
 *  `RefusalSurface`'s detail line, `transport.radient` through the computer
 *  switcher's transport line. */
const PRE_S1_LATIN_INITIAL_UR_KEYS = [
	"mobile.computers.billing_help",
	"mobile.computers.disabled_help",
	"mobile.computers.harness_help",
	"mobile.computers.transport.radient",
] as const;

/** Latin-initial too, and a TextInput PLACEHOLDER: a plain `dir` on the field
 *  would also set the base of the password the reader types, so the cure is the
 *  opt-in `Input.placeholderDir`, which states the page direction only while the
 *  value is empty (designer source preflight, M3 S2a). Kept as its own list
 *  because its channel differs from the `Text` spreads above. */
const OPEN_LATIN_INITIAL_UR_KEYS = [
	"mobile.computers.password_placeholder",
] as const;

const read = (relative: string): string =>
	readFileSync(new URL(relative, import.meta.url), "utf8");

const render = (children: ReactNode, direction: "ltr" | "rtl"): string =>
	renderToStaticMarkup(
		h(DirectionProvider, { direction, locale: "ur", children }),
	);

describe("S1 Urdu values that start with a Latin token", () => {
	it("the premise: the set of Latin-initial S1 ur values is EXACTLY the four fixed here", () => {
		const catalogue = (namespace: string) =>
			JSON.parse(
				read(`../../i18n/catalogues/ur/mobile.${namespace}.json`),
			) as Record<string, string>;
		const ur = { ...catalogue("computers"), ...catalogue("signin") };
		/* The S1 slice's own key list: the applied draft kept with its audit evidence
		 * (44 keys), so the set cannot drift from what this PR shipped. */
		const s1 = JSON.parse(
			read(
				"../../../i18n/audits/evidence/ur/m3-s1-signin-computers/draft-ur-s1.json",
			),
		) as Record<string, string>;
		/* First LETTER after the ICU slots are dropped: `{name}، …` opens with a
		 * placeholder, not with a script, and `dir="auto"` skips neutrals. */
		const firstLetter = (value: string) =>
			value.replace(ICU_SLOT, "").match(FIRST_LETTER)?.[0] ?? "";
		const latinInitial = Object.keys(s1)
			.filter((key) => STARTS_LATIN.test(firstLetter(ur[key] ?? "")))
			.sort();
		/* A fifth Latin-initial value is a new site that needs the same cure; this
		 * fails with the key named instead of passing silently. */
		expect(
			latinInitial,
			"S1 ur values whose first letter is Latin must each be listed in LATIN_INITIAL_UR_KEYS AND spread useComposedDir()",
		).toEqual([...LATIN_INITIAL_UR_KEYS].sort());
		expect(Object.keys(s1)).toHaveLength(44);
	});
});

describe("Button: a Latin-initial label can state the page's base", () => {
	const label = renderFor("mobile.signin.start", {}, "ur");
	it("rtl: labelDir reaches the label's Text as an explicit dir", () => {
		const markup = render(
			h(Button, {
				label,
				onPress: () => undefined,
				testID: "t",
				labelDir: { dir: "rtl" },
			}),
			"rtl",
		);
		expect(markup).toContain('dir="rtl"');
		expect(markup).not.toContain('dir="auto"');
	});
	it("no labelDir: every other Button keeps the inferred base (opt-in, default unchanged)", () => {
		const markup = render(
			h(Button, { label: "Retry", onPress: () => undefined, testID: "t" }),
			"rtl",
		);
		expect(markup).toContain('dir="auto"');
	});
});

describe("TunnelPaths (the Radient card): title and body state the base in ur", () => {
	const title = renderFor("mobile.computers.paths.radient_title", {}, "ur");
	const body = renderFor("mobile.computers.paths.radient_body", {}, "ur");
	/* `children` is a required prop of the component, so it is passed by name; the
	 * rule against it targets JSX, where the nested form is available. */
	const paths = () =>
		h(TunnelPaths, {
			onOwnTunnel: () => undefined,
			// biome-ignore lint/correctness/noChildrenProp: required prop, createElement form
			children: null,
		});
	/* The component reads the ACTIVE locale through `t()`, so the render has to run
	 * under ur — otherwise it would look up English strings and prove nothing. */
	beforeEach(() => setLocaleSource(() => "ur"));
	afterEach(() => resetLocaleSource());
	it("rtl: the title and the body EACH carry dir=rtl, not the inferred base", () => {
		const markup = render(paths(), "rtl");
		/* Each value is located by its FULL text, never a shared prefix: title and
		 * body both open with `Radient `, so a prefix anchor resolved both to the
		 * title and a missing body spread went unnoticed (QA r2 Q-01). */
		const openingTagOf = (value: string) => {
			const at = markup.indexOf(value);
			expect(at, `${value.slice(0, 20)}… is rendered`).toBeGreaterThan(-1);
			return markup.slice(markup.lastIndexOf("<", at), at);
		};
		expect(openingTagOf(title)).toContain('dir="rtl"');
		expect(openingTagOf(body)).toContain('dir="rtl"');
		expect(openingTagOf(title)).not.toBe(openingTagOf(body));
	});
	it("ltr: those two Texts are unchanged (inferred base)", () => {
		const markup = render(paths(), "ltr");
		expect(markup).toContain('dir="auto"');
		expect(markup).not.toContain('dir="rtl"');
	});
});

describe("screens: the Latin-initial values spread the composed direction", () => {
	const textOpeningBefore = (source: string, anchor: string): string => {
		const at = source.indexOf(anchor);
		expect(at, `anchor ${anchor}`).toBeGreaterThan(-1);
		return source.slice(source.lastIndexOf("<Text", at), at);
	};
	it("computers.tsx wait panel: the tunnel-status line", () => {
		const source = read("./computers.tsx");
		expect(
			textOpeningBefore(source, '{t("mobile.computers.wait.tunnel_status"'),
		).toContain("{...composedDir}");
	});
	it.each([["sign-in.tsx"], ["welcome.tsx"]])(
		"%s: the Sign in with Radient button passes labelDir",
		(file) => {
			const source = read(`./${file}`);
			expect(source).toContain("const composedDir = useComposedDir();");
			const at = source.indexOf('label={t("mobile.signin.start")}');
			expect(at).toBeGreaterThan(-1);
			expect(source.slice(at, at + 160)).toContain("labelDir={composedDir}");
		},
	);
});

describe("Q-02: every Latin-initial ur value in the computers and sign-in namespaces", () => {
	it("the premise: the whole-namespace set is S1's four, the four fixed in S2a, and the placeholder fixed via Input.placeholderDir", () => {
		const catalogue = (namespace: string) =>
			JSON.parse(
				read(`../../i18n/catalogues/ur/mobile.${namespace}.json`),
			) as Record<string, string>;
		const ur = { ...catalogue("computers"), ...catalogue("signin") };
		const firstLetter = (value: string) =>
			value.replace(ICU_SLOT, "").match(FIRST_LETTER)?.[0] ?? "";
		/* The WHOLE namespaces this time, not S1's draft: Q-02's values predate it.
		 * A new Latin-initial value fails here with its key named. */
		const latinInitial = Object.keys(ur)
			.filter((key) => STARTS_LATIN.test(firstLetter(ur[key] ?? "")))
			.sort();
		expect(latinInitial).toEqual(
			[
				...LATIN_INITIAL_UR_KEYS,
				...PRE_S1_LATIN_INITIAL_UR_KEYS,
				...OPEN_LATIN_INITIAL_UR_KEYS,
			].sort(),
		);
	});

	it("RefusalSurface: the detail line (billing/disabled/harness help) spreads the composed direction", () => {
		const source = read("../../ui/components/refusal-surface.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		const at = source.indexOf("{detail}\n");
		expect(at).toBeGreaterThan(-1);
		expect(source.slice(source.lastIndexOf("<Text", at), at)).toContain(
			"{...composedDir}",
		);
	});

	it("computer switcher: the Radient transport word spreads the composed direction", () => {
		const source = read("./computer-switcher-sheet.tsx");
		const anchor = '{t("mobile.computers.transport.radient")}';
		const at = source.indexOf(anchor);
		expect(at).toBeGreaterThan(-1);
		expect(source.slice(source.lastIndexOf("<Text", at), at)).toContain(
			"{...composedDir}",
		);
	});

	it("own-tunnel.tsx: BOTH password fields pass placeholderDir={composedDir}", () => {
		const source = read("./own-tunnel.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		const anchor = 'placeholder={t("mobile.computers.password_placeholder")}';
		const sites: string[] = [];
		for (
			let at = source.indexOf(anchor);
			at > -1;
			at = source.indexOf(anchor, at + 1)
		) {
			sites.push(source.slice(at, source.indexOf("/>", at)));
		}
		expect(sites).toHaveLength(2);
		for (const site of sites) {
			expect(site).toContain("placeholderDir={composedDir}");
		}
	});

	it("password_placeholder: the real ur hint gets dir=rtl only while the field is empty", () => {
		const hint = renderFor("mobile.computers.password_placeholder", {}, "ur");
		expect(STARTS_LATIN.test(hint.match(FIRST_LETTER)?.[0] ?? "")).toBe(true);
		const Field = ({ value }: { value: string }) =>
			h(Input, {
				label: "password",
				value,
				onChangeText: () => {},
				placeholder: hint,
				placeholderDir: useComposedDir(),
				secureTextEntry: true,
				testID: "password",
			});
		const inputTag = (value: string) => {
			const markup = render(h(Field, { value }), "rtl");
			const at = markup.indexOf("<input");
			expect(at).toBeGreaterThan(-1);
			return markup.slice(at, markup.indexOf(">", at) + 1);
		};
		expect(inputTag("")).toContain('dir="rtl"');
		expect(inputTag("hunter2")).not.toContain('dir="rtl"');
		expect(inputTag("pass کلید")).not.toContain('dir="rtl"');
		expect(inputTag("")).toContain('dir="rtl"');
	});

	it("own-tunnel.tsx: the password_for heading ({name}-initial in ur) spreads the composed direction", () => {
		/* M3 S2a R1: the ur value opens with the `{name}` slot, so a Latin computer
		 * name is its first strong letter and `dir="auto"` would resolve the
		 * heading LTR on an RTL page. Source-level: the screen's native stack does
		 * not import under Node, and the ur value lands with the S2a catalogue. */
		const source = read("./own-tunnel.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		const anchor = '{t("mobile.computers.own_tunnel.password_for"';
		const at = source.indexOf(anchor);
		expect(at).toBeGreaterThan(-1);
		expect(source.slice(source.lastIndexOf("<Text", at), at)).toContain(
			"{...composedDir}",
		);
	});

	it("password_for: the real ur heading opens with a Latin {name}, and the composed spread gives it dir=rtl", () => {
		/* The premise behind the spread above: the ur value is `{name}`-initial, so
		 * a Latin computer name is the first strong letter `dir="auto"` would see. */
		const heading = renderFor(
			"mobile.computers.own_tunnel.password_for",
			{ name: "Mac mini" },
			"ur",
		);
		expect(heading.startsWith("Mac mini ")).toBe(true);
		expect(heading).toMatch(ARABIC_SCRIPT);
		/* The heading's own shape: a `Text` spreading `useComposedDir()` (widened to
		 * `object` because `dir` is not in RN's `TextProps`, as in direction.test). */
		const Heading = () => {
			const dir: object = useComposedDir();
			return h(Text, dir, heading);
		};
		expect(render(h(Heading), "rtl")).toContain('dir="rtl"');
		expect(render(h(Heading), "ltr")).not.toContain('dir="rtl"');
	});
});
