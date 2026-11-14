import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	RelayError,
	relayErrorFromResponse,
	transportError,
} from "@/relay/errors";
import {
	diagnosticReason,
	reasonCodeOf,
	reasonForStatus,
	STREAM_CLOSED_REASON,
	STREAM_STALLED_REASON,
} from "./stream-health-reason";

/**
 * Diagnostics must name the raw input behind "Not answering" / "Asleep"
 * (Sherman's phone said both while his Mac reported healthy, and nothing on the
 * phone said WHICH degraded input it had received). These pin the derivation
 * from the real error taxonomy and the wiring through the provider to the row.
 */
const SRC = join(process.cwd(), "src");
const source = (path: string) => readFileSync(join(SRC, path), "utf8");
const flat = (path: string) => source(path).replace(/\s+/g, " ");
const noHeaders = () => null;

describe("reasonCodeOf: the most specific code an error carries", () => {
	it("prefers the gateway's own reason, verbatim, even one this build does not know", () => {
		const known = relayErrorFromResponse({
			status: 503,
			header: noHeaders,
			body: {
				detail: "Console unreachable.",
				reason: "control_plane_unreachable",
			},
		});
		expect(reasonCodeOf(known)).toBe("control_plane_unreachable");
		const future = relayErrorFromResponse({
			status: 503,
			header: noHeaders,
			body: { detail: "Something new.", reason: "relay_unreachable" },
		});
		expect(reasonCodeOf(future)).toBe("relay_unreachable");
	});
	it("falls back to a typed code, then an identifier-shaped error, then the kind", () => {
		expect(
			reasonCodeOf(
				new RelayError("rejected", "x", {
					code: "operator_authority_required",
					serverError: "nope",
				}),
			),
		).toBe("operator_authority_required");
		expect(
			reasonCodeOf(
				new RelayError("relay-down", "x", { serverError: "relay_unreachable" }),
			),
		).toBe("relay_unreachable");
		expect(reasonCodeOf(transportError(new Error("fetch failed")))).toBe(
			"transport",
		);
	});
	it("never shows a sentence, markup or an unbounded wire string as a code", () => {
		const unauthorized = relayErrorFromResponse({
			status: 401,
			header: noHeaders,
			body: { error: "authentication required" },
		});
		expect(reasonCodeOf(unauthorized)).toBe(unauthorized.kind);
		expect(
			reasonCodeOf(
				new RelayError("rejected", "x", {
					reasonRaw: "<html><body>502 Bad Gateway</body></html>",
					code: "x".repeat(65),
					serverError: "Bearer abc.def",
				}),
			),
		).toBe("rejected");
	});
	/* PR #258 R1 n1: a dotted lowercase string is the shape of a host name. */
	it("refuses a dotted value, so a host name never passes as a code", () => {
		expect(
			reasonCodeOf(
				new RelayError("relay-down", "x", {
					reasonRaw: "my-mac.local",
					code: "relay.unreachable",
					serverError: "host.example.com",
				}),
			),
		).toBe("relay-down");
		expect(
			reasonCodeOf(new RelayError("rejected", "x", { code: "rate-limit_2" })),
		).toBe("rate-limit_2");
	});
});

describe("reasonForStatus: the stream's own reason across transitions", () => {
	it("names a keep-alive stall, and a bare close only when no error said more", () => {
		expect(reasonForStatus("stalled", null)).toBe(STREAM_STALLED_REASON);
		expect(STREAM_STALLED_REASON).toBe("stream_stalled");
		expect(reasonForStatus("closed", null)).toBe(STREAM_CLOSED_REASON);
		expect(reasonForStatus("closed", "relay_unreachable")).toBe(
			"relay_unreachable",
		);
	});
	it("keeps the reason through a reconnect and clears it once healthy", () => {
		expect(reasonForStatus("connecting", "transport")).toBe("transport");
		for (const healthy of ["open", "rotating", "idle"] as const)
			expect(reasonForStatus(healthy, "transport")).toBeNull();
	});
});

describe("diagnosticReason: what the Diagnostics row shows", () => {
	const offline = new RelayError("computer-offline", "x", {});
	it("is the stream's reason while unhealthy", () => {
		for (const health of ["degraded", "offline", "connecting"] as const)
			for (const refused of [false, true])
				expect(
					diagnosticReason({
						health,
						healthReason: STREAM_STALLED_REASON,
						lastError: offline,
						refused,
					}),
				).toBe(STREAM_STALLED_REASON);
	});
	it("is the last error's code while the stream is not live (the path that makes the switcher say Asleep)", () => {
		for (const health of ["idle", "offline", "degraded"] as const)
			expect(
				diagnosticReason({
					health,
					healthReason: null,
					lastError: offline,
					refused: false,
				}),
			).toBe("computer-offline");
	});
	/* PR #258 R1 m2: `lastError` outlives the failure (it is not cleared when
	 *  the stream recovers), so beside "Stream: live" it is a past fact. */
	it("shows None beside a live stream unless a refusal is current", () => {
		expect(
			diagnosticReason({
				health: "live",
				healthReason: null,
				lastError: offline,
				refused: false,
			}),
		).toBeNull();
		expect(
			diagnosticReason({
				health: "live",
				healthReason: null,
				lastError: offline,
				refused: true,
			}),
		).toBe("computer-offline");
	});
	it("never presents a recovered stall as current, and is empty when nothing failed", () => {
		expect(
			diagnosticReason({
				health: "live",
				healthReason: STREAM_STALLED_REASON,
				lastError: null,
				refused: false,
			}),
		).toBeNull();
	});
});

describe("the provider carries the code from the stream to Connection", () => {
	const provider = flat("features/auth/connection-provider.tsx");
	it("records it on every stream transition and on both error branches", () => {
		expect(provider).toContain(
			"setStreamHealthReason((previous) => reasonForStatus(status.state, previous), );",
		);
		/* The retryable branch never reaches `noteError`, which is why "Last error"
		 *  was empty for exactly the case Sherman hit. */
		expect(provider).toContain(
			'setStreamHealth("degraded"); setStreamHealthReason(reasonCodeOf(error));',
		);
		expect(provider).toContain(
			'setStreamHealth("offline"); setStreamHealthReason(reasonCodeOf(error));',
		);
	});
	it("clears it for a new stream and on sign-out, and publishes it", () => {
		expect(provider).toContain(
			"stopStream(); /* A new stream is a new route (or a reader's retry)",
		);
		expect(provider).toContain(
			"if (mountedRef.current) setStreamHealthReason(null);",
		);
		expect(provider).toContain(
			'setStreamHealth("idle"); setStreamHealthReason(null);',
		);
		expect(provider).toContain(
			"streamHealthReason: StreamHealthReason | null;",
		);
	});
});

describe("Settings › Diagnostics shows `reason: <code>`, monospace and copyable", () => {
	const settings = flat("features/settings/settings.tsx");
	it("renders the row beside Stream, from diagnosticReason, untranslated", () => {
		const stream = settings.indexOf(
			'label={t("mobile.settings.diagnostics.stream")}',
		);
		const reason = settings.indexOf(
			'label={t("mobile.settings.diagnostics.reason")}',
		);
		const lastError = settings.indexOf(
			'label={t("mobile.settings.diagnostics.last_error")}',
		);
		expect(stream).toBeGreaterThan(-1);
		expect(reason).toBeGreaterThan(stream);
		expect(lastError).toBeGreaterThan(reason);
		const row = settings.slice(reason, lastError);
		expect(row).toContain(
			"diagnosticReason({ health: streamHealth, healthReason: streamHealthReason, lastError, refused: refusal !== null, })",
		);
		/* Merge of #261: the value goes through Copy diagnostics' redaction
		 *  (`diagnosticsReasonValue`, pinned in diagnostics-text.test.ts). */
		expect(row).toContain("? diagnosticsReasonValue(code)");
		expect(row).toContain("selectable");
		expect(row).toContain("testID={CONTROL.settingsDiagnosticsReason}");
	});
	it("the row's value is set in the mono face and is selectable", () => {
		expect(settings).toContain("text-mono-sm text-ink-dim");
		expect(settings).toContain("selectable={selectable}");
	});
	it("keys the label in all 8 locales; the code itself is never a catalogue value", () => {
		for (const locale of ["en", "es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
			const catalogue = JSON.parse(
				source(`i18n/catalogues/${locale}/mobile.settings.json`),
			) as Record<string, string>;
			const label = catalogue["mobile.settings.diagnostics.reason"];
			expect(label, locale).toBeTruthy();
			expect(label).not.toMatch(/reason:|stream_stalled|\{/);
		}
	});
});
