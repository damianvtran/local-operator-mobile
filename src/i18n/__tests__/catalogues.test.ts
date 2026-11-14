import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { ShippedLocale } from "@/i18n";
import {
	CATALOGUES,
	ENGLISH_CATALOGUE,
	ENGLISH_CONTEXT,
	ENGLISH_MESSAGES,
	parseMessage,
	renderFor,
	SHIPPED_LOCALES,
} from "@/i18n";
import accountRoutingContext from "@/i18n/catalogues/en/mobile.account_routing.context.json";
import accountRouting from "@/i18n/catalogues/en/mobile.account_routing.json";
import agentAvatarContext from "@/i18n/catalogues/en/mobile.agent_avatar.context.json";
import agentAvatar from "@/i18n/catalogues/en/mobile.agent_avatar.json";
import chromeContext from "@/i18n/catalogues/en/mobile.chrome.context.json";
import chrome from "@/i18n/catalogues/en/mobile.chrome.json";
import commonContext from "@/i18n/catalogues/en/mobile.common.context.json";
import common from "@/i18n/catalogues/en/mobile.common.json";
import composerInputContext from "@/i18n/catalogues/en/mobile.composer_input.context.json";
import composerInput from "@/i18n/catalogues/en/mobile.composer_input.json";
import computersContext from "@/i18n/catalogues/en/mobile.computers.context.json";
import computers from "@/i18n/catalogues/en/mobile.computers.json";
import homeContext from "@/i18n/catalogues/en/mobile.home.context.json";
import home from "@/i18n/catalogues/en/mobile.home.json";
import libraryContext from "@/i18n/catalogues/en/mobile.library.context.json";
import library from "@/i18n/catalogues/en/mobile.library.json";
import notificationsContext from "@/i18n/catalogues/en/mobile.notifications.context.json";
import notifications from "@/i18n/catalogues/en/mobile.notifications.json";
import oauthContext from "@/i18n/catalogues/en/mobile.oauth.context.json";
import oauth from "@/i18n/catalogues/en/mobile.oauth.json";
import projectsContext from "@/i18n/catalogues/en/mobile.projects.context.json";
import projects from "@/i18n/catalogues/en/mobile.projects.json";
import schedulesContext from "@/i18n/catalogues/en/mobile.schedules.context.json";
import schedules from "@/i18n/catalogues/en/mobile.schedules.json";
import sessionContext from "@/i18n/catalogues/en/mobile.session.context.json";
import session from "@/i18n/catalogues/en/mobile.session.json";
import sessionHealthContext from "@/i18n/catalogues/en/mobile.session_health.context.json";
import sessionHealth from "@/i18n/catalogues/en/mobile.session_health.json";
import settingsContext from "@/i18n/catalogues/en/mobile.settings.context.json";
import settings from "@/i18n/catalogues/en/mobile.settings.json";
import sidebarContext from "@/i18n/catalogues/en/mobile.sidebar.context.json";
import sidebar from "@/i18n/catalogues/en/mobile.sidebar.json";
import signinContext from "@/i18n/catalogues/en/mobile.signin.context.json";
import signin from "@/i18n/catalogues/en/mobile.signin.json";
import teamBridgeContext from "@/i18n/catalogues/en/mobile.team_bridge.context.json";
import teamBridge from "@/i18n/catalogues/en/mobile.team_bridge.json";
import relayChromeContext from "@/i18n/catalogues/en/relay.chrome.context.json";
import relayChrome from "@/i18n/catalogues/en/relay.chrome.json";
import relayComposerContext from "@/i18n/catalogues/en/relay.composer.context.json";
import relayComposer from "@/i18n/catalogues/en/relay.composer.json";
import healthContext from "@/i18n/catalogues/en/relay.health.context.json";
import health from "@/i18n/catalogues/en/relay.health.json";
import relayTranscriptContext from "@/i18n/catalogues/en/relay.transcript.context.json";
import relayTranscript from "@/i18n/catalogues/en/relay.transcript.json";

const ROLES = ["heading", "help", "status", "button", "confirm", "meta"];

/**
 * The catalogues' own invariants. `tsc` proves the key surface; these prove the
 * DATA behind it — that every message parses, that every key has translator
 * context, and that the four namespaces do not quietly collide.
 */
const JSON_SUFFIX = /\.json$/;

const NAMESPACES = [
	{
		name: "mobile.team_bridge",
		messages: teamBridge,
		context: teamBridgeContext,
		// Current union: endpoint-profile keys plus six delivery/help keys.
		expected: 159, // Exact merged Team Bridge key union (TestFlight 773 retired thread.placeholder); +2: thread.jump_newest and thread.anchor_missing (anchored opens).
	},
	{
		name: "mobile.signin",
		messages: signin,
		context: signinContext,
		expected: 33, // M3 S2a +1: the loopback-unavailable detail (32 + 1 = 33); 18 + 14: S1 sign-in panel, sign-in/welcome screens (M3 slice S1)
	},
	{
		name: "mobile.oauth",
		messages: oauth,
		context: oauthContext,
		expected: 4,
	},
	{
		name: "mobile.common",
		messages: common,
		context: commonContext,
		expected: 13, // M3 S2b-1 +3: the command block's Copy / Copied / copy hint (10 + 3 = 13); +4: the not-found screen (app/ scan)
	},
	{
		name: "mobile.composer_input",
		messages: composerInput,
		context: composerInputContext,
		expected: 14, // +2: the failure notice's short Retry / Dismiss actions (visual audit D6)
	},
	{
		name: "mobile.library",
		messages: library,
		context: libraryContext,
		expected: 32,
	},
	{
		name: "mobile.home",
		messages: home,
		context: homeContext,
		/* 31 from the round-1 remediation's two options-sheet rows ("back to the
		 *  computer's default" for the folder and for the model): 29 before them.
		 *  65 with the three pickers (#182): 32 for the chips' spoken labels, the
		 *  effort names and the pickers' copy, and 2 from its round-1 remediation
		 *  ("Default effort" on the chip, "This computer's level" in the sheet). */
		expected: 65,
	},
	{
		name: "mobile.projects",
		messages: projects,
		context: projectsContext,
		expected: 32,
	},
	{
		name: "mobile.schedules",
		messages: schedules,
		context: schedulesContext,
		expected: 38,
	},
	{
		name: "mobile.account_routing",
		messages: accountRouting,
		context: accountRoutingContext,
		expected: 14,
	},
	{
		/* The agent picture's two strings: the header picture's name and the
		 *  "change it on the desktop" hint the phone answers a press with. */
		name: "mobile.agent_avatar",
		messages: agentAvatar,
		context: agentAvatarContext,
		expected: 2,
	},
	{
		name: "mobile.computers",
		messages: computers,
		context: computersContext,
		/* main's 24 + the two transport keys + nine refused-connect keys (own-tunnel
		 * "Couldn't connect" with its generic and wrong-password bodies, the
		 * secure-storage refusal, "Connected, but not saved" with its body with and
		 * without a code, and Continue). */
		expected: 162, // M3 S2b-2a +24: the connection-failure (refusal) surface: 9 headlines, 9 next lines, wait line, 5 buttons (138 + 24 = 162); M3 S2b-1 +27: own-tunnel command labels/notes and tunnel rule (11), verdict sentences (12), offline remedy (1), password-slot explanations (3) (111 + 27 = 138); M3 S2a +36: Computers titles (2), discovery banners (4), "Your own tunnel" screen (30) (75 + 36 = 111); M3 S1 +30 (17 + 13 sweep: status/reach badges, row a11y, billing, Try now, Remove; 45 + 30 = 75); +17: computers list/remove/paths/wait lines (45 + 17 = 62); earlier: +6: the add-a-computer wait panel's keyed lines (app/ scan); +4: the wait panel's remaining expression literals (host/answering lines, fallback name, connected-to line)
	},
	{
		name: "mobile.notifications",
		messages: notifications,
		context: notificationsContext,
		// +5: the Settings permission sentences (`permission.*`), moved out of
		// an English-only table in the Team Bridge push-readiness PR.
		// +6: the Settings registration sentences (`computer_registration.*`),
		// fix/session-push-register.
		expected: 38,
	},
	{
		name: "mobile.session",
		messages: session,
		context: sessionContext,
		expected: 80, // +3: Title-case sheet titles (visual audit D14); +1: newest-edge gap notice; +1: reload hint; +1: newest-refresh failure copy; +1: explicit history reload; +7: lazy history states; +1: default-closed reasoning disclosure; +1: retry-attempt storage receipt; +1: definitely-not-sent storage receipt; +3: the ended-session chip hints (TestFlight 578); +9: the pending echo; +16: session route literals keyed by the app/ scan (subagent screen, empty states, find, chip errors, retained notice); +2: the user message's Show more / Show less (iOS build 836); +15: scanner-blind expression literals (context tray, scroll cues, video title, fallback names, region labels, back-to labels)
	},
	{
		/* The relay's own two namespaces, under its own keys. They are here rather
		 * than renamed into `mobile.*` because the strings are AUDITED SAFETY COPY
		 * from the web client (`local_operator/i18n/catalogues/en/relay.health.json`
		 * at 24d328a19a): sharing the key means one state cannot be named two ways,
		 * and a renamed key would hide that the two clients say the same thing. */
		name: "relay.health",
		messages: health,
		context: healthContext,
		expected: 8,
	},
	{
		/* The relay's Stop words, mirrored key for key from the core
		 * (`local_operator/i18n/catalogues/<locale>/relay.composer.json` at
		 * 6fc208f636d) for the pinned working line's Stop — the same verb the relay
		 * shows, so the two clients cannot name the action two ways. A subset: only
		 * the three keys this app renders. */
		name: "relay.composer",
		messages: relayComposer,
		context: relayComposerContext,
		expected: 3,
	},
	{
		/* The relay's transcript condensing and tool-fold vocabulary, mirrored key
		 * for key from the core (`local_operator/i18n/catalogues/<locale>/relay.transcript.json`)
		 * so completed-turn bars, tool folds and receipt labels speak the same words
		 * on phone and relay web. */
		name: "relay.transcript",
		messages: relayTranscript,
		context: relayTranscriptContext,
		expected: 19,
	},
	{
		/* This app's own chrome for the health surface: the control's labels, the
		 *  Resume flow's sentences and the reopen line. APP-OWNED, in the
		 *  `mobile.*` convention #112 established, because a later adoption of the
		 *  core's locale files must not silently overwrite or orphan them (review
		 *  round 3 m1 / UX U15 / design D13). */
		name: "mobile.session_health",
		messages: sessionHealth,
		context: sessionHealthContext,
		expected: 10, // -1: `ended_placeholder` retired, the ended composer shows the standard placeholder
	},
	{
		/* Settings → Appearance and the Theme screen (decision record
		 *  `mobile-design-direction.md` § 5). Theme NAMES are not keys: they are
		 *  proper nouns, verbatim in every locale, as on the desktop. */
		name: "mobile.settings",
		messages: settings,
		context: settingsContext,
		expected: 75, // +4 the account card's `account.signed_in_radient` and the `sign_in_confirm` dialog (PR #258 R1 B1/m1); +1 `diagnostics.reason` (the raw stream-health reason row, Sherman's report); M3 S2b-1 +11: the own-tunnel section of Settings (59 + 11 = 70); +27: Settings screen literals keyed by the app/ scan (title, sections, rows, diagnostics, sign-out); +14: Settings expression literals (account card, status words, stream words, relay words)
	},
	{
		/* The conversations drawer's View options (TestFlight 906): the desktop's
		 *  `ui.chat.sidebar_view.*` words mirrored, plus the phone's ended switch,
		 *  its hint, the "More sidebar settings" link and the Settings heading. */
		name: "mobile.sidebar",
		messages: sidebar,
		context: sidebarContext,
		expected: 25,
	},
	{
		/* This app's own short chrome words the relay has no key for: the sidebar
		 *  destinations' one-word labels, the More sheet's title, and (from the
		 *  2026-11-05 build389 pass) the composer's context strip plus the home's
		 *  single presentation story, and (sidebar-density review round 1) the
		 *  sidebar's "Close conversations" accessible name. */
		name: "mobile.chrome",
		messages: chrome,
		context: chromeContext,
		expected: 26, // +5: the More sheet's row labels (visual audit D5); +1 its Questions row (build 753)
	},
	{
		name: "relay.chrome",
		messages: relayChrome,
		context: relayChromeContext,
		expected: 20,
	},
] as const;

describe("the English catalogues", () => {
	it.each(NAMESPACES)("$name owns its keys and nothing else", (namespace) => {
		const keys = Object.keys(namespace.messages);
		expect(keys).toHaveLength(namespace.expected);
		for (const key of keys) {
			expect(key.startsWith(`${namespace.name}.`)).toBe(true);
		}
	});

	it.each(NAMESPACES)("$name has non-empty source and context", (namespace) => {
		const messages = namespace.messages as Record<string, string>;
		const contexts = namespace.context as Record<
			string,
			{ role: string; note: string }
		>;
		expect(Object.keys(contexts).sort()).toEqual(Object.keys(messages).sort());
		for (const [key, value] of Object.entries(messages)) {
			expect(value.trim().length).toBeGreaterThan(0);
			expect(value).toBe(value.trim());
			const entry = contexts[key];
			expect(entry).toBeDefined();
			expect(ROLES).toContain(entry?.role);
			expect(entry?.note.trim().length ?? 0).toBeGreaterThan(20);
		}
	});

	it.each(NAMESPACES)("$name's messages all parse", (namespace) => {
		for (const value of Object.values(
			namespace.messages as Record<string, string>,
		)) {
			expect(() => parseMessage(value)).not.toThrow();
		}
	});

	it("merges into one map without a duplicate key", () => {
		const total = NAMESPACES.reduce(
			(sum, namespace) => sum + Object.keys(namespace.messages).length,
			0,
		);
		expect(Object.keys(ENGLISH_CATALOGUE)).toHaveLength(total);
		/* Exact merged union: main's 542 (538 plus #206's four editor-only
		 * clear/dismiss labels and hints) and the eleven lazy-history keys this
		 * branch adds; verified by counting the generated catalogue after the merge. */
		/* Plus two from the header/drawer/secondary-screens polish: the
		 * Settings "Text size" label and the Library filter sheet's "Source".
		 * Merged with the polish-composer branch (563 on its own): 563 + 2,
		 * verified by counting unique `en` keys over the merged tree. */
		/* Plus one: More's Questions row, the door to timed-out asks now that
		 * they paint no ask bar (PR #211, TestFlight build 753 feedback). */
		/* Plus three from the workspace drawer's Team Bridge mode (#212): the
		 * Bridge entry's loading and unavailable names and "Open Team Bridge".
		 * PR #211 merged with main a563a6f3: 566 + 3, verified by counting
		 * unique `en` keys over the merged tree. */
		/* Minus one: TestFlight 773 retired `mobile.team_bridge.thread.placeholder`
		 * — the Bridge composer shows its field label, the title names the
		 * channel. 569 - 1. */
		/* Plus seven for refused-connect feedback on the own-tunnel screen: the
		 * inline "Couldn't connect" title and generic body, the secure-storage
		 * refusal sentence with and without a platform code, and the "Connected,
		 * but not saved" title, consequence and Continue. 569 + 7, verified by the
		 * generator's own count (576 keys). PR #220 round-1 remediation: + the
		 * wrong-password body, and the not-saved body (with and without a code)
		 * replacing its "until restart" tail: 576 + 3 - 1 = 578, the generator's
		 * count. */
		/* PR #220 merged with main becb972b (#219 retired one key): 568 + 9 (this
		 * branch's net) = 577, verified by counting unique `en` keys over the merged tree. */
		/* PR #223 merged with main 56831114 (#220): 568 + 19 (this branch's
		 * relay.transcript keys) + 9 (#220's net) = 596, verified by the
		 * generated catalogue's own count over the merged tree. */
		/* feat/bridge-last-target: + `mobile.team_bridge.thread.jump_newest`, the
		 *  anchored open's way back to the newest edge: 596 + 1 = 597, the
		 *  generated catalogue's own count over this tree. Round-1 remediation
		 *  adds `mobile.team_bridge.thread.anchor_missing` (the "no longer
		 *  available" toast): 597 + 1 = 598.
		 * Plus 53 keyed by the app/ scan (the new `app/` coverage in
		 * scan-strings.ts plus the Settings and add-a-computer literals): 598 + 53
		 * = 651, the generator's own count. */
		/* fix/user-message-show-more: + `mobile.session.user_message.show_more`
		 *  and `.show_less`: 651 + 2 = 653, the generated catalogue's own count
		 *  (integration of #235 onto #227). */
		/* Minus one: `mobile.session_health.ended_placeholder` retired — an ended
		 * session's composer shows the standard placeholder (operator feedback,
		 * 2026-11-11). 653 - 1 = 652 (integration of #239). */
		/* feat/bridge-push-readiness (#231) merged with main fa2bc5e0 (#227): + the
		 *  five `mobile.notifications.permission.*` Settings sentences: 651 + 5 = 656.
		 *  Integrated with #235 (+2) and #239 (-1): 652 + 5 = 657. */
		/* M2 (#236) expression-literal keys (4 computers + 15 session + 14
		 * settings = 33), rebased onto main 2b508d9d: 657 + 33 = 690. */
		/* M3 slice S1 (sign-in & computers): +17 mobile.computers + 14 mobile.signin
		 * = 31 English keys, plus 13 from the unflagged-literal sweep (status/reach
		 * badges, row a11y, billing fallback, Try now, Remove): 690 + 44 = 734. */
		/* M3 slice S2a (English-first): +36 mobile.computers (titles, discovery
		 * banners, the "Your own tunnel" screen) + 1 mobile.signin (loopback
		 * unavailable detail) = 37: 734 + 37 = 771, counted over the en JSON. */
		/* M3 slice S2b-1 (English-first): +27 mobile.computers (own-tunnel
		 * commands, verdicts, remedy, password slot) + 3 mobile.common (command
		 * block) + 11 mobile.settings (own-tunnel section) = 41: 771 + 41 = 812,
		 * counted over the en JSON. */
		/* M3 slice S2b-2a (English-first): +24 mobile.computers (the refusal
		 * surface's headlines, next lines, wait line and buttons): 812 + 24 = 836,
		 * counted over the en JSON. */
		/* TestFlight 906 drawer View options: + the 21 `mobile.sidebar.*` keys
		 * (order, grouping, clock, ended, sections, link, heading): 771 + 21 = 792,
		 * the generator's own count. */
		/* PR #255 review round 1: + "N sections hidden" and the emptied-by-view
		 * state's headline, line and action (D2, M1): 792 + 4 = 796. */
		/* Merge of origin/main (#254, d5831603) into #255: 771 + 41 (S2b-1)
		 * + 25 (mobile.sidebar: 21 + 4) = 837. */
		/* Convergence of #257 onto main f8d0d8dd (#255): both comment chains kept;
		 * 812 + 24 (S2b-2a) + 25 (mobile.sidebar) = 861, counted over the en JSON. */
		/* fix/session-push-register: +6 mobile.notifications (the Settings
		 * sentence for this phone's registration with the routed computer):
		 * 812 + 6 = 818. */
		/* Merge of origin/main (#255, f8d0d8dd) into #259: 837 on main + 6
		 * mobile.notifications = 843. */
		/* Convergence of #257 onto main 9ef19ccd (#259): both comment chains kept;
		 * 861 + 6 (mobile.notifications) = 867, counted over the en JSON. */
		/* fix/settings-signin-status-badge: +1 mobile.settings
		 * (`diagnostics.reason`, the label of the raw reason-code row; the code
		 * itself is never a key): 812 + 1 = 813. Review round 1: +4 (the signed-in
		 * account title and the sign-in confirm's title, body and button):
		 * 813 + 4 = 817. */
		/* Merge of origin/main (#255, f8d0d8dd) into #258: 837 on main + 5
		 * mobile.settings = 842. */
		/* Merge of origin/main (#259, 9ef19ccd) into #258: 843 on main + 5
		 * mobile.settings = 848. */
		/* Convergence of #257 onto main 8ca71d54 (#258): both comment chains kept;
		 * 867 + 5 (mobile.settings) = 872, counted over the en JSON. */
		expect(total).toBe(872);
	});

	it("lists every catalogue file this suite checks", () => {
		/* A namespace added on disk but not above would dodge every invariant here,
		 * so the directory is the oracle for the list. */
		const root = fileURLToPath(
			new URL("../../i18n/catalogues/en", import.meta.url),
		);
		const onDisk = readdirSync(root)
			.filter(
				(name) => name.endsWith(".json") && !name.endsWith(".context.json"),
			)
			.map((name) => name.replace(JSON_SUFFIX, ""))
			.sort();
		expect(NAMESPACES.map((namespace) => namespace.name).sort()).toEqual(
			onDisk,
		);
	});

	it("ships no locale the runtime cannot render", () => {
		/* A translation directory that lands without a passed audit must not become
		 * renderable — and must not sit there looking shipped either. This compares
		 * the catalogue DIRECTORY with the runtime's shipped list, so adding `fr/`
		 * without wiring it is a red test rather than a silent no-op. */
		const root = fileURLToPath(
			new URL("../../i18n/catalogues", import.meta.url),
		);
		const directories = readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		expect(directories).toEqual([...SHIPPED_LOCALES].sort());
	});
});

/**
 * A SHIPPED LOCALE IS STILL TRANSLATED.
 *
 * The gap this closes: every other check in the programme answers "does the key
 * exist", and a translation REVERTED to its English text — the ordinary way a
 * value is lost in a rebase or a hand-merge — passes all of them. The key is
 * present, the message parses, the parameter names still match (English's own
 * do), and the screen renders a sentence. Nothing says the reader asked for
 * French and got English back.
 *
 * So: no shipped locale may carry a value equal to the English source unless it
 * is on a short, reasoned allowlist. `CATALOGUES` is read rather than the JSON
 * files, so the check is against the map the RUNTIME reads — a locale that
 * exists on disk but is not shipped is somebody's draft, and its own audit is
 * where that is judged.
 *
 * The allowlist is checked in BOTH directions: a newly identical value fails as
 * untranslated, and an entry that is no longer identical fails as stale, so an
 * exemption cannot quietly become permanent.
 */
const IDENTITY_PROSE = /[\p{L}\p{N}]/u;
/* These are valid ASCII identifiers and tag examples, not untranslated prose.
 * List them per locale below so a changed translation is still caught as stale. */
const PROJECT_NAME_EXAMPLE = {
	"mobile.projects.create.name_placeholder":
		"Valid project-name example: the relay accepts ASCII letters, digits, dot, underscore or hyphen and the example preserves that grammar.",
};
const PROJECT_TAG_EXAMPLE = {
	"mobile.projects.create.tags_placeholder":
		"Valid ASCII tag examples with a comma separator; retaining the examples preserves the form's concrete input guidance.",
};

/** The judged exceptions, per locale (no pending-translation ledger remains). */
const IDENTICAL_BY_DESIGN_JUDGED: Readonly<
	Record<ShippedLocale, Readonly<Record<string, string>>>
> = {
	en: {},
	fr: {
		"mobile.sidebar.sections":
			"« Sections » is the French word for the drawer's sections, spelled as in English; the desktop's French catalogue uses the same word (`ui.chat.sidebar_view.sections`).",
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.session.fallback_name":
			"session is the French cognate for the bare-noun header title; identical spelling is idiomatic (M2 audit), not an English fallback.",
		"mobile.session.region.label_subagents":
			"agents is the normal French plural for the sub-agents region label; identical spelling is idiomatic (M2 round-2 audit), not an English fallback.",
		"mobile.session.subagent.prompt_label":
			"`prompt` is the French style-guide glossary-kept term for the model input (audited in the m1 translator wave); it is intentional, not an English fallback.",
		"mobile.settings.about.version":
			"Version is the correct French cognate for the app-version row label; identical spelling is idiomatic, not an English fallback.",
		"mobile.team_bridge.attachment.image":
			"Image is the French noun for a picture too; the isolated attachment label is an idiomatic cognate.",
		"mobile.team_bridge.attachment.chip_label":
			"French uses Image followed by the image number and a separately localized state; this template contains no English prose.",
		"mobile.chrome.drawer.agents":
			"Agents is also the French plural for software agents; the drawer mode names the agent conversations, not an English fallback.",
		"mobile.team_bridge.profile.name_with_owner":
			"Placeholder-only identity template `{agent} ({owner})`: both arguments are current display names, which are never translated; the parentheses contain no prose.",
		"mobile.team_bridge.profile.badge_agent":
			"Agent is also the French term for a software agent; this role badge is an idiomatic cognate, not an English fallback.",
		"mobile.team_bridge.profile.message":
			"Message is also the French noun for the profile contact action; opening the message composer does not send a message.",
		"mobile.team_bridge.delivery.recipient":
			"Agent is also the French noun for the recipient agent; identical spelling is intentional, not an English fallback.",
		"mobile.team_bridge.conversation":
			"Conversation is also the French noun for a conversation; the correct isolated heading has identical spelling.",
		"mobile.team_bridge.thread.message":
			"Message is also the French noun used for a message input label; identical bytes are idiomatic French.",
		"mobile.team_bridge.thread.notifications":
			"Notifications is the French platform label too, matching the existing notifications screen title.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.row.a11y":
			"Placeholder-only screen-reader label, `{name}, {status}, {reach}` — every part is a placeholder and the separators are commas; there is no prose to translate. The sibling a11y_active and a11y_connecting keys end in a translated word and are not identical.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		"mobile.session.highlights.withheld_reasons_join":
			"Placeholder-only list separator, `{first}, {second}` — this locale enumerates with the Latin comma; there is no prose to translate.",
		...PROJECT_TAG_EXAMPLE,
		"mobile.projects.create.description":
			"Description is the same French word for the project description field, not English fallback.",
		"mobile.projects.status.validation":
			"Validation is the same French word for the project lifecycle status, not English fallback.",
		/* French spells these the same as English. `Description` is the French
		 * word for the same field, not an untranslated value: the asset editor's
		 * label, sitting beside `Nom` and `Étiquettes` in the same sheet. */
		"mobile.library.editor.description":
			"French spells this field the same way — « Description » is the French word for the label, beside « Nom » and « Étiquettes » in the same editor.",
		/* The three pickers' (#182) two words French spells as English: the effort
		 *  sheet's title and the lowest-but-one rung. */
		"mobile.home.picker.effort_title":
			"French uses the same word — « Effort » is the French noun for the setting, the title of the sheet that picks it.",
		"mobile.home.effort.minimal":
			"French spells the adjective the same way — « Minimal » is the French name of the rung, beside « Faible » and « Moyen » on the same ladder.",
		/* The 2026-11-04 chrome words. The two relay.* values are the core
		 *  relay's own French catalogue, mirrored; all three are French words. */
		"relay.chrome.session.tray.agents":
			"Mirrored from the core relay's French catalogue: « Agents » is the French word, and the count template is unchanged.",
		"relay.chrome.row.tags":
			"Mirrored from the core relay's French catalogue, which keeps « Tags » (the app's own tag vocabulary in French).",
		"mobile.chrome.destinations":
			"« Destinations » is the French word for the same set of places.",
		"mobile.chrome.composer.row_effort":
			"« Effort » is the French word, and the one the French effort chip already uses (« Effort par défaut »).",
		"mobile.chrome.composer.row_questions":
			"« Questions » is the French plural of « question », spelled as in English.",
		"mobile.session.sheet_title.effort":
			"« Effort » is the French word; the sheet's title is that one noun.",
		"mobile.notifications.title":
			"French spells this one the same: 'Notifications' is the platform's own word for the screen, not an English sentence left behind.",
		/* French « session » is the same word as English "session": identical
		 * bytes here are the correct translation, not a value nobody translated. */
		"mobile.session_health.menu_title":
			"French spells “session” the same way; equality is correct here, not a fallback.",
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — the two arguments are pre-rendered sentences and the middle dot is a separator.",
		"relay.transcript.label.messages":
			"« Messages » is the French plural of « message », mirrored verbatim from the core relay catalogue.",
	},
	/* Spanish preserves these placeholder-only templates: names and separators
	 * have no English prose to translate. Each key remains explicitly listed. */
	es: {
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.session.subagent.prompt_label":
			"`prompt` is the Spanish glossary-kept term for the model input (audited in the m1 translator wave); it is intentional, not an English fallback.",
		"mobile.team_bridge.profile.name_with_owner":
			"Placeholder-only identity template `{agent} ({owner})`: both arguments are current display names, which are never translated; the parentheses contain no prose.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.row.a11y":
			"Placeholder-only screen-reader label, `{name}, {status}, {reach}` — every part is a placeholder and the separators are commas; there is no prose to translate. The sibling a11y_active and a11y_connecting keys end in a translated word and are not identical.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		"mobile.session.highlights.withheld_reasons_join":
			"Placeholder-only list separator, `{first}, {second}` — this locale enumerates with the Latin comma; there is no prose to translate.",
		...PROJECT_NAME_EXAMPLE,
		...PROJECT_TAG_EXAMPLE,
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — the separator is the same in Spanish; there is no prose to translate.",
	},
	"zh-CN": {
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		...PROJECT_NAME_EXAMPLE,
		...PROJECT_TAG_EXAMPLE,
		/* ASCII example, not an untranslated value */
		"mobile.library.editor.new_tag_placeholder":
			"The server accepts only ASCII slug tags (`^[a-z0-9][a-z0-9_-]{0,23}$`), so the placeholder example stays ASCII here; a localised example is refused when used as a tag.",
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — Chinese carries the separator unchanged; there is no prose to translate.",
	},
	ru: {
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.team_bridge.profile.name_with_owner":
			"Placeholder-only identity template `{agent} ({owner})`: both arguments are current display names, which are never translated; the parentheses contain no prose.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.row.a11y":
			"Placeholder-only screen-reader label, `{name}, {status}, {reach}` — every part is a placeholder and the separators are commas; there is no prose to translate. The sibling a11y_active and a11y_connecting keys end in a translated word and are not identical.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		"mobile.session.highlights.withheld_reasons_join":
			"Placeholder-only list separator, `{first}, {second}` — this locale enumerates with the Latin comma; there is no prose to translate.",
		...PROJECT_NAME_EXAMPLE,
		...PROJECT_TAG_EXAMPLE,
		/* ASCII example, not an untranslated value */
		"mobile.library.editor.new_tag_placeholder":
			"The server accepts only ASCII slug tags (`^[a-z0-9][a-z0-9_-]{0,23}$`), so the placeholder example stays ASCII here; a localised example is refused when used as a tag.",
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — Russian carries the separator unchanged; there is no prose to translate.",
	},
	vi: {
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.session.video.title_fallback":
			"Video is the shipped Vietnamese term for the video screen title (M2 round-2 audit); identical spelling is idiomatic, not an English fallback.",
		"mobile.session.subagent.prompt_label":
			"`prompt` is the Vietnamese binding glossary-kept term for the model input (audited in the m1 translator wave); it is intentional, not an English fallback.",
		"mobile.team_bridge.profile.name_with_owner":
			"Placeholder-only identity template `{agent} ({owner})`: both arguments are current display names, which are never translated; the parentheses contain no prose.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.row.a11y":
			"Placeholder-only screen-reader label, `{name}, {status}, {reach}` — every part is a placeholder and the separators are commas; there is no prose to translate. The sibling a11y_active and a11y_connecting keys end in a translated word and are not identical.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		"mobile.session.highlights.withheld_reasons_join":
			"Placeholder-only list separator, `{first}, {second}` — this locale enumerates with the Latin comma; there is no prose to translate.",
		...PROJECT_NAME_EXAMPLE,
		...PROJECT_TAG_EXAMPLE,
		/* ASCII example, not an untranslated value */
		"mobile.library.editor.new_tag_placeholder":
			"The server accepts only ASCII slug tags (`^[a-z0-9][a-z0-9_-]{0,23}$`), so the placeholder example stays ASCII here; a localised example is refused when used as a tag.",
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — Vietnamese carries the separator unchanged; there is no prose to translate.",
		/* The 2026-11-07 home-pickers audit (VI-H01, vi1107p1) chose the loanword. */
		"mobile.home.picker.folder_home":
			"Vietnamese names the home folder «thư mục home» across mobile and core (relay.chrome.session.ended_hint); the folder badge is its short form «Home», which matches the English spelling. «Thư mục chính» reads as 'main folder'.",
	},
	hi: {
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.team_bridge.profile.name_with_owner":
			"Placeholder-only identity template `{agent} ({owner})`: both arguments are current display names, which are never translated; the parentheses contain no prose.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.row.a11y":
			"Placeholder-only screen-reader label, `{name}, {status}, {reach}` — every part is a placeholder and the separators are commas; there is no prose to translate. The sibling a11y_active and a11y_connecting keys end in a translated word and are not identical.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		"mobile.session.highlights.withheld_reasons_join":
			"Placeholder-only list separator, `{first}, {second}` — this locale enumerates with the Latin comma; there is no prose to translate.",
		...PROJECT_NAME_EXAMPLE,
		...PROJECT_TAG_EXAMPLE,
		/* ASCII example, not an untranslated value */
		"mobile.library.editor.new_tag_placeholder":
			"The server accepts only ASCII slug tags (`^[a-z0-9][a-z0-9_-]{0,23}$`), so the placeholder example stays ASCII here; a localised example is refused when used as a tag.",
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — Hindi carries the separator unchanged; there is no prose to translate.",
		"relay.transcript.fold.shell":
			"Mirrored from the core relay catalogue: technical CLI/runtime token `shell` kept in Latin script beside the count.",
		"relay.transcript.fold.python":
			"Mirrored from the core relay catalogue: language/tool proper token `python` kept in Latin script beside the count.",
	},
	ur: {
		"mobile.settings.account.app_name":
			"Local Operator is the product name, kept in Latin script in every locale (glossary: never translated); audited as required in the M2 expression-literal wave.",
		"mobile.team_bridge.profile.name_with_owner":
			"Placeholder-only identity template `{agent} ({owner})`: both arguments are current display names, which are never translated; the parentheses contain no prose.",
		"mobile.team_bridge.title":
			"Team Bridge is the unchanged product name in every locale, not an untranslated English sentence.",
		"mobile.computers.transport.radient":
			"Radient is the product's name, and every shipped catalogue already keeps it in Latin script inside translated sentences (e.g. the switcher's own section heading); there is no word to translate.",
		...PROJECT_NAME_EXAMPLE,
		...PROJECT_TAG_EXAMPLE,
		/* ASCII example, not an untranslated value */
		"mobile.library.editor.new_tag_placeholder":
			"The server accepts only ASCII slug tags (`^[a-z0-9][a-z0-9_-]{0,23}$`), so the placeholder example stays ASCII here; a localised example is refused when used as a tag.",
		"mobile.schedules.head.overdue":
			"Placeholder-only template, `{head} · {label}` — Urdu carries the separator unchanged; there is no prose to translate.",
		"relay.transcript.fold.shell":
			"Mirrored from the core relay catalogue: technical CLI/runtime token `shell` kept in Latin script beside the count.",
		"relay.transcript.fold.python":
			"Mirrored from the core relay catalogue: language/tool proper token `python` kept in Latin script beside the count.",
	},
};

describe("a shipped translation is still translated", () => {
	const shipped = SHIPPED_LOCALES.filter((locale) => locale !== "en");

	it.each(shipped)("%s: no value falls back to the English text", (locale) => {
		const catalogue = CATALOGUES[locale] as Readonly<Record<string, string>>;
		const source = ENGLISH_MESSAGES as Readonly<Record<string, string>>;
		const identical = Object.keys(source)
			.filter((key) => catalogue[key] === source[key])
			.sort();
		expect(identical).toEqual(
			Object.keys(IDENTICAL_BY_DESIGN_JUDGED[locale] ?? {}).sort(),
		);
	});

	it("keeps exempt profile-name templates free of untranslated prose", () => {
		const key = "mobile.team_bridge.profile.name_with_owner";
		for (const locale of shipped) {
			if (!IDENTICAL_BY_DESIGN_JUDGED[locale]?.[key]) continue;
			// Empty caller names expose only the template itself. A future English
			// phrase cannot silently inherit this names-and-punctuation exception.
			expect(renderFor(key, { agent: "", owner: "" }, locale)).not.toMatch(
				IDENTITY_PROSE,
			);
		}
	});

	it("gives every allowlisted value its reason", () => {
		/* The reason is the reviewable part: an entry without one is a blanket
		 *  exemption, and the point of the list is that each case was judged. */
		for (const perLocale of Object.values(IDENTICAL_BY_DESIGN_JUDGED)) {
			for (const [key, reason] of Object.entries(perLocale)) {
				expect(reason.trim().length).toBeGreaterThan(20);
				expect(Object.keys(ENGLISH_MESSAGES)).toContain(key);
			}
		}
	});
});

/**
 * Russian plural agreement, bound as a test rather than an audit snapshot.
 *
 * `Intl.PluralRules("ru")` selects four categories, and the four arms are only
 * correct if each renders the NUMERAL AND THE NOUN FORM its category demands —
 * "1 сессия", not "1 сессий". The audit measured this once; this keeps it
 * measured on every run, because a plural that loses an arm still parses and
 * still passes a key-parity check.
 */
describe("a four-form plural locale agrees with its own rules", () => {
	const cases: ReadonlyArray<readonly [number, string]> = [
		[0, "0 пробуждений"],
		[1, "1 пробуждение"],
		[2, "2 пробуждения"],
		[5, "5 пробуждений"],
		[21, "21 пробуждение"],
		[1.5, "1.5 пробуждения"],
	];

	it.each(cases)("renders %s wakes as «%s»", (count, expected) => {
		expect(renderFor("mobile.schedules.count.wakes", { count }, "ru")).toBe(
			expected,
		);
	});

	it("agrees on a second noun, so this is the rules and not one lucky key", () => {
		expect(
			renderFor("mobile.projects.sessions.count", { count: 1 }, "ru"),
		).toBe("1 сессия");
		expect(
			renderFor("mobile.projects.sessions.count", { count: 3 }, "ru"),
		).toBe("3 сессии");
		expect(
			renderFor("mobile.projects.sessions.count", { count: 8 }, "ru"),
		).toBe("8 сессий");
	});

	it("keeps Hindi's zero on the one arm, as its own rules and core do", () => {
		/* Hindi selects `one` for 0 where English selects `other`. Both auditors
		 * disagreed about whether `0 जागृति` is idiomatic; CLDR, core's committed
		 * Hindi and the hi style guide all put 0 in `one`, so the shipped
		 * behaviour is pinned here — a change to the arms cannot land silently. */
		expect(renderFor("mobile.schedules.count.wakes", { count: 0 }, "hi")).toBe(
			"0 जागृति",
		);
		expect(renderFor("mobile.schedules.count.wakes", { count: 2 }, "hi")).toBe(
			"2 जागृतियाँ",
		);
	});

	it("carries all four arms in the shipped catalogue", () => {
		/* A dropped `few` or `many` arm would fall back to `other` and still
		 * render, so the arms are asserted directly rather than inferred from
		 * output. */
		const value = (CATALOGUES.ru as Readonly<Record<string, string>>)[
			"mobile.schedules.count.wakes"
		];
		for (const arm of ["one", "few", "many", "other"]) {
			expect(value).toContain(`${arm} {`);
		}
	});
});

/**
 * The account-routing seam, bound explicitly.
 *
 * That feature module cannot import the runtime: a plain-`node` CI entry pinned by
 * `account-routing-proof.test.ts` statically imports it, and Node cannot resolve
 * `src/`'s extensionless imports. It therefore keeps its own English table (the
 * version this module's own test already asserts) while the catalogue carries the
 * same messages. THIS test is what makes that duplication safe: if either side
 * changes alone, the build goes red.
 */
describe("the account-routing copy table mirrors its catalogue", () => {
	it("agrees key for key on source, context and role", async () => {
		const { ACCOUNT_ROUTING_COPY, ACCOUNT_ROUTING_SOURCE_LOCALE } =
			await import("@/features/settings/account-routing-copy");
		expect(ACCOUNT_ROUTING_SOURCE_LOCALE).toBe("en");
		const keys = Object.keys(ACCOUNT_ROUTING_COPY).sort();
		expect(keys).toEqual(Object.keys(accountRouting).sort());
		for (const key of keys) {
			const entry =
				ACCOUNT_ROUTING_COPY[key as keyof typeof ACCOUNT_ROUTING_COPY];
			expect(entry.source).toBe(
				(ENGLISH_MESSAGES as Record<string, string>)[key],
			);
			const context = (
				ENGLISH_CONTEXT as Record<string, { role: string; note: string }>
			)[key];
			expect(entry.context).toBe(context?.note);
			expect(entry.role).toBe(context?.role);
		}
	});
});
