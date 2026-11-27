import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	NESTED_ROUTE_NAMES,
	routeClassOf,
	screenOptionsForRoute,
	TOP_LEVEL_ROUTE_NAMES,
	TOP_LEVEL_SCREEN_OPTIONS,
} from "@/features/sessions/top-level-routes";

/**
 * The route-class ledger: every screen file under `app/(app)` must be declared
 * top-level or nested by name, and the classes decide the stack's screen
 * options. Read from the filesystem rather than from the router so a renamed or
 * added screen fails here instead of silently inheriting the wrong class.
 */

const appGroup = fileURLToPath(new URL("../../../app/(app)", import.meta.url));

const routeFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return routeFiles(path);
		if (!name.endsWith(".tsx") || name === "_layout.tsx") return [];
		return [path];
	});

/** A file path under `app/(app)` to the route name expo-router uses. */
const WINDOWS_SEPARATOR = /\\/g;
const TSX_EXTENSION = /\.tsx$/;
const routeNameOf = (path: string): string =>
	relative(appGroup, path)
		.replace(WINDOWS_SEPARATOR, "/")
		.replace(TSX_EXTENSION, "");

describe("every (app) route has an explicit class", () => {
	it("finds the route files, so a move cannot make the ledger vacuous", () => {
		const names = routeFiles(appGroup).map(routeNameOf);
		expect(names.length).toBe(
			TOP_LEVEL_ROUTE_NAMES.length + NESTED_ROUTE_NAMES.length,
		);
		expect(names).toContain("index");
		expect(names).toContain("session/[id]");
		expect(names).toContain("notifications/index");
	});

	it("classifies every file and declares no phantom route", () => {
		const found = routeFiles(appGroup).map(routeNameOf).sort();
		const declared = [...TOP_LEVEL_ROUTE_NAMES, ...NESTED_ROUTE_NAMES].sort();
		expect(found).toEqual(declared);
		for (const name of found) expect(routeClassOf(name), name).not.toBeNull();
	});

	it("keeps the drawer's destinations top-level and details nested", () => {
		for (const name of TOP_LEVEL_ROUTE_NAMES) {
			expect(routeClassOf(name), name).toBe("top-level");
		}
		for (const name of NESTED_ROUTE_NAMES) {
			expect(routeClassOf(name), name).toBe("nested");
		}
	});
});

describe("the class derives the stack options", () => {
	it("top-level: no native pop, no slide", () => {
		for (const name of TOP_LEVEL_ROUTE_NAMES) {
			expect(screenOptionsForRoute(name), name).toEqual({
				gestureEnabled: false,
				animation: "none",
			});
		}
		expect(TOP_LEVEL_SCREEN_OPTIONS.gestureEnabled).toBe(false);
		expect(TOP_LEVEL_SCREEN_OPTIONS.animation).toBe("none");
	});

	it("nested: the app's shared options, never a top-level override", () => {
		for (const name of NESTED_ROUTE_NAMES) {
			expect(screenOptionsForRoute(name), name).toBeUndefined();
		}
	});

	it("an undeclared route has no class and no options", () => {
		expect(routeClassOf("synthetic/unknown")).toBeNull();
		expect(screenOptionsForRoute("synthetic/unknown")).toBeUndefined();
	});
});
