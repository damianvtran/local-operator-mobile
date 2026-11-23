/**
 * PROOF-ONLY seam for the Bridge thread viewport's diagnostics.
 *
 * WHY: #304 QA R4 Q1 (a warm notification tap opened a thread whose rows
 * stayed hidden on Android API 29/31) could not be root-caused from the hosted
 * installed-app run: the transcript screen logs nothing about its landing, and
 * no local emulator reproduces the hosted timing. The viewport and the screen
 * report every landing input (layout, content size with `dataReady`, scroll,
 * `dataChanged`, why `position()` returned early, metadata/admission flips) to
 * this sink, so the next proof run's logcat shows the exact event order.
 *
 * CONSTRAINT: the sink is null in every committed build, so the normal bundle
 * carries no logger and no proof marker (the installed-app harness fails the
 * run if a marker reaches it). Only the hosted installed-app proof job
 * (`scripts/ci/android-installed-app-proof/prepare.ts`, #309) replaces the
 * export line below — anchored on its exact text and failing closed if it
 * moved — with a `console.info` logger behind its own job-only define, the
 * same way it injects its Team Bridge fixture, and restores this file after
 * export. Keep the line's text stable; change it together with the harness.
 */
import type { ThreadViewportTrace } from "@/features/team-bridge/thread-viewport";

export type { ThreadViewportTrace };

export const threadViewportTrace: ThreadViewportTrace | null = null;
