import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { generate, loadSources, validateSources } from "./generate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sources = () => loadSources(root);
const generated = () => {
	const path = join(root, "src/i18n/keys.gen.ts");
	return existsSync(path) ? readFileSync(path, "utf8") : null;
};

test("generated key map is deterministic and current", () => {
	const input = sources();
	const output = generate(input);
	assert.equal(output, generate(input));
	assert.equal(generated(), output);
});

test("generation drift is observable, not silently repaired by check", () => {
	const input = sources();
	input.english["mobile.home.greeting"] = "A different greeting";
	assert.notEqual(generate(input), generated());
});

test("source/context keys and contextual parameter declarations must agree", () => {
	const input = sources();
	delete input.context["mobile.home.greeting"];
	assert.throws(() => validateSources(input), /context keys/);
	const mismatch = sources();
	const greeting = mismatch.context["mobile.home.greeting"];
	assert.ok(greeting);
	greeting.params = { count: "number" };
	assert.throws(() => validateSources(mismatch), /placeholder notes/);
});

test("an enabled locale cannot omit any enabled namespace or English key", () => {
	const absentNamespace = sources();
	absentNamespace.config.enabledLocales.push("fr");
	absentNamespace.config.locales.fr = { direction: "ltr" };
	assert.throws(() => validateSources(absentNamespace), /missing enabled namespace/);
	const absentKey = sources();
	absentKey.config.enabledLocales.push("fr");
	absentKey.config.locales.fr = { direction: "ltr" };
	absentKey.catalogues.fr = { "mobile.home": { ...absentKey.english } };
	delete absentKey.catalogues.fr?.["mobile.home"]?.["mobile.home.starting"];
	assert.throws(() => validateSources(absentKey), /missing enabled key/);
});

test("production eligibility stays English-only and Urdu remains explicitly held", () => {
	assert.deepEqual(sources().config.enabledLocales, ["en"]);
	assert.equal(sources().config.locales.ur?.direction, "rtl");
	assert.ok(sources().config.locales.ur?.hold);
});
