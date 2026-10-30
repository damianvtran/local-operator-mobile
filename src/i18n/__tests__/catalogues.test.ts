import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	CATALOGUES,
	ENGLISH_CATALOGUE,
	ENGLISH_CONTEXT,
	ENGLISH_MESSAGES,
	parseMessage,
	SHIPPED_LOCALES,
} from "@/i18n";
import accountRoutingContext from "@/i18n/catalogues/en/mobile.account_routing.context.json";
import accountRouting from "@/i18n/catalogues/en/mobile.account_routing.json";
import computersContext from "@/i18n/catalogues/en/mobile.computers.context.json";
import computers from "@/i18n/catalogues/en/mobile.computers.json";
import homeContext from "@/i18n/catalogues/en/mobile.home.context.json";
import home from "@/i18n/catalogues/en/mobile.home.json";
import notificationsContext from "@/i18n/catalogues/en/mobile.notifications.context.json";
import notifications from "@/i18n/catalogues/en/mobile.notifications.json";
import projectsContext from "@/i18n/catalogues/en/mobile.projects.context.json";
import projects from "@/i18n/catalogues/en/mobile.projects.json";
import schedulesContext from "@/i18n/catalogues/en/mobile.schedules.context.json";
import schedules from "@/i18n/catalogues/en/mobile.schedules.json";
import sessionContext from "@/i18n/catalogues/en/mobile.session.context.json";
import session from "@/i18n/catalogues/en/mobile.session.json";
import sessionHealthContext from "@/i18n/catalogues/en/mobile.session_health.context.json";
import sessionHealth from "@/i18n/catalogues/en/mobile.session_health.json";
import relayChromeContext from "@/i18n/catalogues/en/relay.chrome.context.json";
import relayChrome from "@/i18n/catalogues/en/relay.chrome.json";
import healthContext from "@/i18n/catalogues/en/relay.health.context.json";
import health from "@/i18n/catalogues/en/relay.health.json";

const ROLES = ["heading", "help", "status", "button", "confirm", "meta"];

/**
 * The catalogues' own invariants. `tsc` proves the key surface; these prove the
 * DATA behind it — that every message parses, that every key has translator
 * context, and that the four namespaces do not quietly collide.
 */
const NAMESPACES = [
	{
		name: "mobile.home",
		messages: home,
		context: homeContext,
		expected: 27,
	},
	{
		name: "mobile.projects",
		messages: projects,
		context: projectsContext,
		expected: 15,
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
		name: "mobile.computers",
		messages: computers,
		context: computersContext,
		expected: 10,
	},
	{
		name: "mobile.notifications",
		messages: notifications,
		context: notificationsContext,
		expected: 14,
	},
	{
		name: "mobile.session",
		messages: session,
		context: sessionContext,
		expected: 2,
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
		/* This app's own chrome for the health surface: the control's labels, the
		 *  Resume flow's sentences and the two reopen lines. APP-OWNED, in the
		 *  `mobile.*` convention #112 established, because a later adoption of the
		 *  core's locale files must not silently overwrite or orphan them (review
		 *  round 3 m1 / UX U15 / design D13). */
		name: "mobile.session_health",
		messages: sessionHealth,
		context: sessionHealthContext,
		expected: 11,
	},
	{
		name: "relay.chrome",
		messages: relayChrome,
		context: relayChromeContext,
		expected: 4,
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
		expect(total).toBe(143);
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
			.map((name) => name.replace(/\.json$/, ""))
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
const IDENTICAL_BY_DESIGN: Readonly<Record<string, string>> = {
	"mobile.notifications.title":
		"French spells this one the same: 'Notifications' is the platform's own word for the screen, not an English sentence left behind.",
	/* French « session » is the same word as English "session": identical bytes
	 * here are the correct translation, not a value nobody translated. */
	"mobile.session_health.menu_title":
		"French spells “session” the same way; equality is correct here, not a fallback.",
	"mobile.schedules.head.overdue":
		"Placeholder-only template, `{head} · {label}` — the two arguments are pre-rendered sentences and the middle dot is a separator.",
};

describe("a shipped translation is still translated", () => {
	const shipped = SHIPPED_LOCALES.filter((locale) => locale !== "en");
	const allowlisted = Object.keys(IDENTICAL_BY_DESIGN).sort();

	it.each(shipped)("%s: no value falls back to the English text", (locale) => {
		const catalogue = CATALOGUES[locale] as Readonly<Record<string, string>>;
		const source = ENGLISH_MESSAGES as Readonly<Record<string, string>>;
		const identical = Object.keys(source)
			.filter((key) => catalogue[key] === source[key])
			.sort();
		expect(identical).toEqual(allowlisted);
	});

	it("gives every allowlisted value its reason", () => {
		/* The reason is the reviewable part: an entry without one is a blanket
		 *  exemption, and the point of the list is that each case was judged. */
		for (const [key, reason] of Object.entries(IDENTICAL_BY_DESIGN)) {
			expect(reason.trim().length).toBeGreaterThan(20);
			expect(Object.keys(ENGLISH_MESSAGES)).toContain(key);
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
