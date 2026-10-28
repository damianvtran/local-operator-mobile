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

/* @ts-expect-error — an unknown key is a compile error, not `undefined` at run time. */
t("mobile.home.greetingg");

/* @ts-expect-error — a key from another namespace does not exist until it is added. */
t("mobile.session.untracked");

/* @ts-expect-error — a parameterised message cannot be called without its arguments. */
t("mobile.projects.sessions.count");

/* @ts-expect-error — a plural count must be a number, not a string. */
t("mobile.schedules.count.wakes", { count: "3" });

/* @ts-expect-error — a required argument cannot be omitted. */
t("mobile.schedules.truncated", { shown: 1, total: 2 });

/* @ts-expect-error — a parameterless message takes no arguments at all. */
t("mobile.home.greeting", { count: 1 });

/* @ts-expect-error — an extra argument the message does not declare is rejected. */
t("mobile.projects.sessions.count", { count: 1, extra: 2 });
