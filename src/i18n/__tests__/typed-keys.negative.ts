/**
 * Compile-time proof of the typed key surface.
 *
 * This file is not a test: `tsc --noEmit` is the test. Every `@ts-expect-error`
 * below must be an actual error — if the surface ever loosens (a key union
 * widened to `string`, a parameter map that stops checking arguments), the
 * directive becomes unused and `tsc` fails with TS2578. That is the point: the
 * negative cases are enforced by the compiler, not by a reviewer remembering
 * them.
 *
 * It sits outside `*.test.ts` on purpose — vitest would never execute these
 * calls, and a run of them would prove nothing.
 */
import { t } from "@/i18n";

/* Positive controls: these must compile with no directive. */
t("mobile.home.greeting");
t("mobile.account_routing.save");
t("mobile.projects.sessions.count", { count: 2 });
t("mobile.projects.sessions.live", { base: "2 sessions", live: 1 });
t("mobile.schedules.count.wakes", { count: 3 });
t("mobile.schedules.truncated", { shown: 1, total: 2, family: "wakes" });
/* Positive controls for the strictest-kind rule: a parameter a SHIPPED locale
 * pluralizes takes a NUMBER, and a number still satisfies a plain placeholder. */
t("mobile.schedules.cadence.left", { cadence: "every 1d", remaining: 3 });
t("mobile.projects.milestones.count", { completed: 2, total: 3 });

/* @ts-expect-error — an unknown key is a compile error, not `undefined` at run time. */
t("mobile.home.greetingg");

/* @ts-expect-error — a key from another namespace does not exist until it is added. */
t("mobile.session.untracked");

/* @ts-expect-error — a parameterised message cannot be called without its arguments. */
t("mobile.projects.sessions.count");

/* @ts-expect-error — a plural count must be a number, not a string. */
t("mobile.schedules.count.wakes", { count: "3" });

/* THE STRICTEST KIND ACROSS SHIPPED LOCALES (review B1). English spells these
 * two arguments as plain placeholders — `{cadence} · {remaining} left` and
 * `{completed} of {total} milestones` — and French pluralizes both. The type is
 * therefore `number`, which is what the renderer requires of a plural: a string
 * would render in English and throw `RangeError` in French, from one call site.
 * If a translation stops pluralizing one of these, the directive below becomes
 * unused and `tsc` fails with TS2578 — loosening the type is a catalogue change
 * that has to be reviewed, never a silent one. */
/* @ts-expect-error — French pluralizes `remaining`; a string renders in English and throws in French. */
t("mobile.schedules.cadence.left", { cadence: "every 1d", remaining: "3" });

/* @ts-expect-error — French pluralizes `completed`; a string is not a plural count in any locale. */
t("mobile.projects.milestones.count", { completed: "2", total: 3 });

/* @ts-expect-error — a required argument cannot be omitted. */
t("mobile.schedules.truncated", { shown: 1, total: 2 });

/* @ts-expect-error — a parameterless message takes no arguments at all. */
t("mobile.home.greeting", { count: 1 });

/* @ts-expect-error — an extra argument the message does not declare is rejected. */
t("mobile.projects.sessions.count", { count: 1, extra: 2 });
