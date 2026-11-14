import { readFileSync } from "node:fs";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { DirectionProvider, useComposedDir } from "@/ui/direction";
import { TunnelPaths } from "./tunnel-paths";
import { verdictOpensWithDetail } from "./tunnel-verdict";

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
/* `Alert` reads the text scale through `uniwind`, which Node cannot parse; the
 * scale only picks the action layout, irrelevant to the body's direction (same
 * stub as ask-bar.test.ts). */
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

/* `RefusalSurface`'s alert mark is a `lucide-react-native` icon (native SVG, Flow
 * source Node cannot parse; same stub as computers-add-wait.test.ts). The mark is
 * irrelevant to the label's direction. */
vi.mock("lucide-react-native", () => ({ AlertTriangle: () => null }));

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

/** M3 S2b-2a (ur audit UR-C1): a BUTTON label, so its channel is `Button.labelDir`
 *  (as `mobile.signin.start`), on `RefusalSurface`'s console button. */
const S2B2A_LATIN_INITIAL_UR_KEYS = [
	"mobile.computers.refusal.open_console",
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
	it("the premise: the whole-namespace set is S1's four, the four fixed in S2a, the placeholder fixed via Input.placeholderDir, and S2b-2a's console button", () => {
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
				...S2B2A_LATIN_INITIAL_UR_KEYS,
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

	it("RefusalSurface: the Open Radient console button passes labelDir={composedDir}", () => {
		/* M3 S2b-2a ur audit UR-C1: the ur label `Radient کنسول کھولیں` opens with
		 * the Latin product name, so without a stated base `dir="auto"` lays the
		 * button label LTR on an RTL page. Same opt-in as the sign-in button above;
		 * source-level because the surface's native stack does not import here. */
		const source = read("../../ui/components/refusal-surface.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		const at = source.indexOf(
			'label={t("mobile.computers.refusal.open_console")}',
		);
		expect(at).toBeGreaterThan(-1);
		expect(source.slice(at, source.indexOf("/>", at))).toContain(
			"labelDir={composedDir}",
		);
	});

	it("open_console: the real ur label opens with Latin `Radient`, and labelDir from the composed direction gives it dir=rtl", () => {
		/* The premise behind the labelDir above, on the catalogue value itself. */
		const label = renderFor("mobile.computers.refusal.open_console", {}, "ur");
		expect(label.startsWith("Radient ")).toBe(true);
		expect(label).toMatch(ARABIC_SCRIPT);
		/* The site's own shape: the console Button passes `useComposedDir()`. */
		const OpenConsole = () =>
			h(Button, {
				label,
				labelDir: useComposedDir(),
				onPress: () => undefined,
				variant: "outline",
				testID: "t",
			});
		const rtl = render(h(OpenConsole), "rtl");
		expect(rtl).toContain('dir="rtl"');
		expect(rtl).not.toContain('dir="auto"');
		expect(render(h(OpenConsole), "ltr")).not.toContain('dir="rtl"');
	});

	describe("the real RefusalSurface, under the ur catalogue (#257 review N3)", () => {
		/* The test above proves `Button.labelDir`; this one renders the SURFACE, so
		 * the wiring (and the headline/next lines of design D2) is proved by markup
		 * rather than by a source regex. */
		beforeEach(() => setLocaleSource(() => "ur"));
		afterEach(() => resetLocaleSource());
		const SUBJECT = "https://mini.example.net";
		/** The opening tag of the element whose text is exactly `text`. */
		const tagOf = (markup: string, text: string): string => {
			const at = markup.indexOf(`>${text}<`);
			expect(at, `rendered: ${text}`).toBeGreaterThan(-1);
			return markup.slice(markup.lastIndexOf("<", at), at + 1);
		};
		const surface = (kind: "console" | "tunnel-gone") =>
			h(RefusalSurface, {
				kind,
				subject: SUBJECT,
				onOpenConsole: () => undefined,
			});

		for (const kind of ["console", "tunnel-gone"] as const) {
			it(`${kind}: the Open Radient console label, headline and next line carry dir=rtl`, () => {
				const label = renderFor(
					"mobile.computers.refusal.open_console",
					{},
					"ur",
				);
				const title = renderFor(
					kind === "console"
						? "mobile.computers.refusal.console_title"
						: "mobile.computers.refusal.tunnel_gone_title",
					{ subject: SUBJECT },
					"ur",
				);
				const next = renderFor(
					kind === "console"
						? "mobile.computers.refusal.console_next"
						: "mobile.computers.refusal.tunnel_gone_next",
					{},
					"ur",
				);
				const rtl = render(surface(kind), "rtl");
				for (const text of [label, title, next]) {
					expect(tagOf(rtl, text)).toContain('dir="rtl"');
				}
				/* Can fail, and LTR stays untouched: the same tree under an LTR page
				 * falls back to the inferred base on every one of those lines. */
				const ltr = render(surface(kind), "ltr");
				for (const text of [label, title, next]) {
					expect(tagOf(ltr, text)).toContain('dir="auto"');
				}
			});
		}
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

describe("M3 S2b-1 (ur audit): the offline verdict with a relay detail opens with {detail}", () => {
	/* The ur value is `{detail}۔ اس کمپیوٹر پر چلائیں: {command}`: the relay's own
	 * detail (server text, usually Latin — "Tunnel temporarily unavailable") is
	 * its first strong run, so `dir="auto"` would lay the whole verdict line out
	 * LTR on an RTL page and the Urdu remedy would read in the wrong order. The
	 * premise test above strips ICU slots, so a SLOT-initial value is invisible to
	 * it; this block is that case. The cure is the page's composed direction on the
	 * verdict body — and only when the sentence is this one, because
	 * `direction.tsx` forbids a blanket spread (an `invalid.reason` is pure server
	 * text and must keep its own inferred base). */
	it("verdictOpensWithDetail: true only for an offline verdict that carries a detail", () => {
		expect(
			verdictOpensWithDetail({
				kind: "offline",
				detail: "Tunnel temporarily unavailable",
				command: "lop mobile status",
			}),
		).toBe(true);
		expect(
			verdictOpensWithDetail({
				kind: "offline",
				detail: "",
				command: "lop mobile status",
			}),
		).toBe(false);
		expect(verdictOpensWithDetail({ kind: "invalid", reason: "bad URL" })).toBe(
			false,
		);
		expect(verdictOpensWithDetail({ kind: "password" })).toBe(false);
	});

	it("Alert: bodyDir reaches the body Text as an explicit dir; omitted, the body keeps the inferred base", () => {
		/* Shorthand `children`, as `render` above passes it to DirectionProvider:
		 * `AlertProps.children` is a required string, so it rides in the props. */
		const children =
			"Tunnel temporarily unavailable۔ اس کمپیوٹر پر چلائیں: lop";
		const withDir = render(
			h(Alert, { severity: "error", bodyDir: { dir: "rtl" }, children }),
			"rtl",
		);
		expect(withDir).toMatch(/dir="rtl"[^>]*>Tunnel temporarily unavailable/);
		const without = render(h(Alert, { severity: "error", children }), "rtl");
		expect(without).not.toContain('dir="rtl"');
		expect(without).toContain('dir="auto"');
	});

	/**
	 * The `<Alert` opening that renders a `verdictSentence(verdict…)` body.
	 * Anchored on the call's opening only: the saved card passes a third
	 * argument (its own "Test again" label) and biome wraps that call across
	 * lines, so the full single-line call text is not a stable anchor.
	 */
	const verdictAlerts = (source: string): string[] => {
		const anchor = "{verdictSentence(";
		const sites: string[] = [];
		for (
			let at = source.indexOf(anchor);
			at > -1;
			at = source.indexOf(anchor, at + 1)
		) {
			/* Whitespace-free, so biome's line wrapping of the prop is not a failure. */
			sites.push(
				source.slice(source.lastIndexOf("<Alert", at), at).replace(/\s+/g, ""),
			);
		}
		return sites;
	};
	const SPREAD =
		"bodyDir={verdictOpensWithDetail(verdict)?composedDir:undefined}";

	it("own-tunnel.tsx VerdictBlock: the verdict Alert states the page direction for the detail-initial sentence", () => {
		const source = read("./own-tunnel.tsx");
		const block = source.slice(source.indexOf("const VerdictBlock"));
		expect(block).toContain("const composedDir = useComposedDir();");
		const sites = verdictAlerts(block);
		expect(sites).toHaveLength(1);
		expect(sites[0]).toContain(SPREAD);
	});

	it("own-tunnel-settings.tsx: BOTH verdict Alerts state the page direction for the detail-initial sentence", () => {
		const source = read("../settings/own-tunnel-settings.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		const sites = verdictAlerts(source);
		expect(sites).toHaveLength(2);
		for (const site of sites) {
			expect(site).toContain(SPREAD);
		}
	});
	it("verdict_offline_detail: the real ur sentence opens with a Latin {detail}, and the composed body direction gives it dir=rtl", () => {
		/* The premise behind the spread above, on the catalogue value itself. */
		const sentence = renderFor(
			"mobile.computers.own_tunnel.verdict_offline_detail",
			{
				detail: "Tunnel temporarily unavailable",
				command: "lop mobile status",
			},
			"ur",
		);
		expect(sentence.startsWith("Tunnel temporarily unavailable")).toBe(true);
		expect(sentence).toMatch(ARABIC_SCRIPT);
		/* The site's own shape: the verdict Alert passes `useComposedDir()`
		 * (shorthand `children`, as in the Alert test above). */
		const children = sentence;
		const Verdict = () =>
			h(Alert, {
				severity: "error",
				bodyDir: useComposedDir(),
				children,
			});
		expect(render(h(Verdict), "rtl")).toMatch(
			/dir="rtl"[^>]*>Tunnel temporarily unavailable/,
		);
		expect(render(h(Verdict), "ltr")).not.toContain('dir="rtl"');
	});
});
