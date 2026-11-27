import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilitiesSchema, sessionSummarySchema } from "@/contracts";
import {
	remoteSessionsAvailable,
	sessionCapabilities,
	sessionLocation,
	sessionSupplementClient,
	sessionTargetOf,
} from "./session-navigation";

const baseline = {
	available: true,
	version: 1,
	view: true,
	history: true,
	supported_command_ops: ["prompt", "steer"],
	supported_media_kinds: ["image", "video", "file"],
	file_sources: ["retained_document"],
	document_upload: false,
	audio_upload: false,
	skill_invocation: false,
	supplements: false,
	media: true,
};
const row = (remote = true) =>
	sessionSummarySchema.parse({
		session_id: "synthetic-peer-session",
		conversation_name: "Remote proof",
		section: "previous",
		mtime: 0,
		owner_device: "synthetic-owner",
		locality: remote ? "remote" : "local",
	});

describe("normal remote conversation navigation", () => {
	it("exposes a remote Highlight client only with explicit owner-routed read support, preserving local previews", () => {
		const client = { loadFile: () => undefined, loadDocument: () => undefined };
		expect(sessionSupplementClient(true, client)).toBeUndefined();
		expect(
			sessionSupplementClient(true, client, { remote_sessions: baseline }),
		).toBeUndefined();
		expect(
			sessionSupplementClient(true, client, {
				remote_sessions: {
					...baseline,
					supplements: true,
					supplement_kinds: ["document", "file", "sound"],
				},
			}),
		).toBe(client);
		expect(sessionSupplementClient(false, client)).toBe(client);
	});
	it("never offers connected-computer audio upload as remote-owner dictation, while preserving local STT", () => {
		const capabilities = capabilitiesSchema.parse({
			stt: { available: true, path: "connected-only" },
			remote_sessions: {
				...baseline,
				supported_command_ops: ["prompt", "steer"],
				document_upload: false,
			},
		});
		expect(sessionCapabilities(capabilities, false)).toBe(capabilities);
		expect(sessionCapabilities(capabilities, true).stt).toBeUndefined();
		expect(
			sessionCapabilities(capabilities, true).remote_sessions
				?.supported_command_ops,
		).toEqual(["prompt", "steer"]);
		expect(
			sessionCapabilities(capabilities, true).remote_sessions?.document_upload,
		).toBe(false);
	});
	it("opens the ordinary route with display-only owner metadata; local routes stay unchanged", () => {
		expect(sessionLocation(row())).toBe(
			"/session/synthetic-peer-session?remote=1&owner=synthetic-owner",
		);
		expect(sessionLocation(row(false))).toBe("/session/synthetic-peer-session");
		/* The SAME destination as a drawer-pick target carries the metadata as
		 * route params, so a reset rehydrates the remote conversation intact. */
		expect(sessionTargetOf(row())).toEqual({
			name: "session/[id]",
			params: {
				id: "synthetic-peer-session",
				remote: "1",
				owner: "synthetic-owner",
			},
		});
		expect(sessionTargetOf(row(false))).toEqual({
			name: "session/[id]",
			params: { id: "synthetic-peer-session" },
		});
	});
	it("encodes session and owner identifiers without adding relay routing authority", () => {
		const session = row();
		session.session_id = "session /?#";
		session.owner_device = "owner & next";
		expect(sessionLocation(session)).toBe(
			"/session/session%20%2F%3F%23?remote=1&owner=owner+%26+next",
		);
	});
	it("requires the exact complete advertised baseline, never mesh listing or a bare boolean", () => {
		expect(remoteSessionsAvailable(capabilitiesSchema.parse({}))).toBe(false);
		expect(
			remoteSessionsAvailable(
				capabilitiesSchema.parse({ remote_sessions: baseline }),
			),
		).toBe(true);
		expect(
			remoteSessionsAvailable(
				capabilitiesSchema.parse({
					remote_sessions: { ...baseline, supported_command_ops: ["prompt"] },
				}),
			),
		).toBe(false);
		expect(
			remoteSessionsAvailable(
				capabilitiesSchema.parse({
					remote_sessions: {
						available: true,
						version: 1,
						view: true,
						history: true,
						media: true,
						commands: true,
					},
				}),
			),
		).toBe(false);
		for (const field of ["available", "view", "history", "media"])
			expect(
				remoteSessionsAvailable(
					capabilitiesSchema.parse({
						remote_sessions: { ...baseline, [field]: false },
					}),
				),
			).toBe(false);
		expect(
			remoteSessionsAvailable(
				capabilitiesSchema.parse({ remote_sessions: { available: true } }),
			),
		).toBe(false);
		expect(
			capabilitiesSchema.safeParse({ remote_sessions: true }).success,
		).toBe(false);
		expect(
			remoteSessionsAvailable(
				capabilitiesSchema.parse({
					remote_sessions: { ...baseline, version: 2 },
				}),
			),
		).toBe(false);
	});
	it("wires primary tap to open, leaving remote recall on the explicit long press", () => {
		const pane = readFileSync(
			new URL("./conversations-pane.tsx", import.meta.url),
			"utf8",
		);
		const activate = pane
			.split("const activate =")[1]
			?.split("/* STABLE ROW")[0];
		expect(activate).toContain("openSession(session)");
		expect(activate).not.toContain("setMoveTarget");
		expect(pane).toContain("openTopLevel(sessionTargetOf(session))");
		const secondary = pane
			.split("const onRowLongPress =")[1]
			?.split("/* Hoisted")[0];
		expect(secondary).toContain(
			"if (isRemoteRow(session)) rowHandlers.current.setMoveTarget(session)",
		);
	});
});
