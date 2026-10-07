import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every `Modal` renderer PUBLISHES ITS OWN SCOPE — asserted by reading the source.
 *
 * WHY A SOURCE SCAN RATHER THAN A RENDER. The containment rule (`@/ui/modal-stack`)
 * needs each renderer to tell the store which modal a nested one was raised
 * inside, and the only place that can be said is beside the `Modal` the renderer
 * draws. `vitest` here runs in Node without a renderer (ADR 0003 — a test that
 * needs the real renderer belongs in the native layer), so what a test CAN settle
 * is the half that is a property of the source: a file that renders a `Modal`
 * without wrapping it in the provider would silently register as a root, and every
 * modal nested inside it would stand it down — the round-3 blocker, one renderer
 * later (review round 4, R22 and the type-level NIT; the reviewer called the
 * wrapping a convention and asked for exactly this guard).
 *
 * ABSENCE MUST NOT READ AS A PASS: the scan asserts it FOUND the renderers, so a
 * refactor that renames the file or the JSX cannot make this suite vacuous.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		if (name === "node_modules" || name === "dist" || name.startsWith("."))
			return [];
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/** Hoisted: a literal inside the `filter` below would compile once per file walked. */
const RENDERS_A_MODAL = /<Modal[\s>]/;

const sources = [...walk(join(root, "src")), ...walk(join(root, "app"))].filter(
	(path) => path.endsWith(".tsx") || path.endsWith(".ts"),
);

/** The files that render a `Modal` at all, relative to the repository root. */
const renderers = sources
	.filter((path) => RENDERS_A_MODAL.test(readFileSync(path, "utf8")))
	.map((path) => path.slice(root.length));

describe("every Modal renderer publishes its scope", () => {
	it("finds the renderers, so a rename cannot make this vacuous", () => {
		// Three today — `Sheet`, `Dialog` and the conversations drawer — and the
		// count is asserted as a FLOOR rather than as a list, because a fourth
		// renderer is a thing this file must keep working for, not a thing that
		// should fail it.
		expect(renderers.length).toBeGreaterThanOrEqual(3);
		expect(renderers.some((path) => path.endsWith("sheet.tsx"))).toBe(true);
		expect(renderers.some((path) => path.endsWith("dialog.tsx"))).toBe(true);
		expect(
			renderers.some((path) => path.endsWith("conversations-drawer.tsx")),
		).toBe(true);
	});

	it("wraps each of them in the scope provider", () => {
		const missing = renderers.filter(
			(path) =>
				!readFileSync(join(root, path), "utf8").includes(
					"ModalScopeContext.Provider",
				),
		);
		expect(missing).toEqual([]);
	});
});
