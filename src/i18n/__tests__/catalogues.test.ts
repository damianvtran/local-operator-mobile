import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
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
		expect(total).toBe(120);
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
