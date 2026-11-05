import assert from "node:assert/strict";
import type { Server } from "node:http";
import { assertDiagnosticTrace } from "./theme-proof-contract.ts";

// Secure typing still creates XCTest activities. Drop the entire section from
// stored stdio, including an interrupted entry; no secret is put in a predicate,
// event, assertion message or test-runner environment variable.
export function redactCredentialActivity(text: string) {
	return text
		.replace(
			/XCT_CREDENTIAL_ENTRY_BEGIN[\s\S]*?(?:XCT_CREDENTIAL_ENTRY_END\r?\n?|$)/g,
			"<credential-entry-redacted>\n",
		)
		.trimEnd();
}
export function credentialActivityIsMasked(text: string) {
	const start = text.indexOf("XCT_CREDENTIAL_ENTRY_BEGIN"),
		end = text.indexOf("XCT_CREDENTIAL_ENTRY_END", start);
	if (start < 0 || end < 0) return false;
	const entries = [...text.slice(start, end).matchAll(/Type '([^']*)'/g)];
	return entries.length > 0 && entries.every((m) => /^[•●*]+$/u.test(m[1]));
}
// Inspect semantic xcresult activity objects in memory before permitting the raw
// bundle to enter an artifact. SecureTextField alone is not privacy evidence.
export function assertPrivateCredentialActivities(
	objects: readonly unknown[],
	secret: string,
) {
	let count = 0;
	const strings = (node: unknown): string[] =>
		typeof node === "string"
			? [node]
			: Array.isArray(node)
				? node.flatMap(strings)
				: node && typeof node === "object"
					? Object.values(node).flatMap(strings)
					: [];
	const visit = (node: any) => {
		if (!node || typeof node !== "object") return;
		if (node.title?._value === "credential-entry") {
			const titles = strings(node).filter((s) => s.startsWith("Type '"));
			assert(
				titles.length > 0 && titles.every((s) => /^Type '[•●*]+'/.test(s)),
				"credential activity is not proven masked",
			);
			count++;
		}
		for (const child of Object.values(node)) visit(child);
	};
	for (const object of objects) {
		for (const text of strings(object))
			assert(!text.includes(secret), "credential privacy prerequisite failed");
		visit(object);
	}
	assert(count === 1, "missing/duplicate semantic credential-entry activity");
}
export type AuthRequest = {
	id?: number;
	authority?: string;
	phase: string;
	stage?: string;
	requestClass: string;
	method: string;
	status: number;
	atMs?: number;
	elapsedMs?: number;
};
export function observeAuthRequests(server: Server, expectedHost?: string) {
	let active = false,
		stage = "test",
		sequence = 0;
	const arrivals: Omit<AuthRequest, "status">[] = [];
	const completions: AuthRequest[] = [];
	server.on("request", (req, res) => {
		if (!active) return;
		const url = new URL(req.url ?? "/", "http://fixture.invalid");
		const requestClass =
			url.pathname === "/login"
				? "login"
				: url.pathname === "/api/sessions"
					? url.searchParams.get("include_peers") === "true"
						? "peer-list"
						: "session-list"
					: null;
		if (!requestClass) return;
		const entry = {
			id: ++sequence,
			phase: "native-auth",
			authority:
				expectedHost === undefined
					? "fixture"
					: req.headers.host === expectedHost
						? "published-local"
						: "other",
			stage,
			requestClass,
			method: req.method ?? "",
			atMs: Date.now(),
		};
		arrivals.push(entry);
		res.once("finish", () =>
			completions.push({
				...entry,
				status: res.statusCode,
				elapsedMs: Date.now() - entry.atMs,
			}),
		);
	});
	return {
		beginNative: () => {
			active = true;
		},
		beginSave: () => {
			stage = "post-save";
		},
		snapshot: () => ({
			arrivals: [...arrivals],
			completions: [...completions],
		}),
	};
}
export function assertAuthSaveProof(
	events: readonly { event: string; runnerPID?: number }[],
	ledger: readonly AuthRequest[],
	trace: Parameters<typeof assertDiagnosticTrace>[0],
) {
	assert(
		events.filter((e) => e.event === "method-entered").length === 1 &&
			events.some(
				(e) =>
					e.event === "method-entered" &&
					Number.isInteger(e.runnerPID) &&
					(e.runnerPID ?? 0) > 0,
			),
		"missing single actual runner-method PID",
	);
	const required = [
		"method-entered",
		"welcome-ready",
		"auth-connected",
		"auth-save",
		"auth-home",
		"auth-session-row",
	];
	let last = -1;
	for (const event of required) {
		const index = events.findIndex((e) => e.event === event);
		assert(index > last, `missing/out-of-order safe app stage: ${event}`);
		last = index;
	}
	for (const [requestClass, method, status] of [
		["login", "POST", 303],
		["session-list", "GET", 200],
		["peer-list", "GET", 200],
	] as const)
		assert(
			ledger.some(
				(r) =>
					r.phase === "native-auth" &&
					r.authority === "published-local" &&
					r.requestClass === requestClass &&
					r.method === method &&
					r.status === status &&
					(requestClass !== "peer-list" || r.stage === "post-save"),
			),
			`missing native ${requestClass}/${status}${requestClass === "peer-list" ? " after Save" : ""}`,
		);
	assertDiagnosticTrace(trace);
	const save = trace.findIndex((e) => e.stage === "save.begin");
	assert(
		trace.findIndex(
			(e) =>
				e.event === "response" &&
				e.requestClass === "peer-list" &&
				e.status === 200,
		) > save && trace.findIndex((e) => e.stage === "cold-list.applied") > save,
		"provider trace does not prove post-save application",
	);
}
