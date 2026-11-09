import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileAvatarButton } from "@/features/team-bridge/profile-card";
import { avatarKey } from "@/team-bridge/avatars";
import { directoryMemberSchema } from "@/team-bridge/contract";

const scope = vi.hoisted(() => ({
	avatars: {
		peek: vi.fn<(key: string) => string | null>(),
		load: vi.fn(),
		loadEndpoint: vi.fn(),
		fail: vi.fn(),
		epoch: 0,
	},
	hub: { avatarBytes: vi.fn(), endpointAvatarBytes: vi.fn() },
}));

// The regression is the real caller's identity selection, not router/sheet
// behavior, colors or SVG decoding. Keep those boundaries inert while retaining
// the actual ProfileAvatarButton, its hook and the kit Avatar renderer.
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/team-bridge/provider", () => ({
	useTeamBridge: () => scope,
	useTeamBridgeState: () => ({}),
}));
vi.mock("@/features/session/runtime", () => ({
	toBase64: () => {
		throw new Error("The SSR identity probe must not read image bytes");
	},
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#123456" }));
vi.mock("@/ui/components/sheet", () => ({ Sheet: () => null }));
vi.mock("lucide-react-native", async () => {
	const { createElement } = await import("react");
	return {
		Clock: () => createElement("span"),
		MessageSquare: () => createElement("span"),
		Bot: () => createElement("span", { "data-agent-glyph": "true" }),
	};
});

// Synthetic marker, deliberately not a decoded-photo/pixel claim. A positive
// human control proves the fixture exposes cached bytes through the real mark;
// the agent must refuse that SAME owner's entry before any effect can run.
const OWNER_URI = "data:image/png;base64,OWNER_ONLY_SENTINEL";
const HASH = "1111111111111111";
const person = directoryMemberSchema.parse({
	account_id: "acct_owner_fixture",
	display_label: "Owner",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	avatar_url: `/v1/accounts/acct_owner_fixture/avatar?v=${HASH}`,
	profile: { avatar: { hash: HASH } },
	agent: { endpoint_id: "bep_agent_fixture", name: "Nova", state: "active" },
});
const OWNER_KEY = avatarKey(person.account_id, HASH, 64);

beforeEach(() => {
	vi.clearAllMocks();
	scope.avatars.peek.mockImplementation((key) =>
		key === OWNER_KEY ? OWNER_URI : null,
	);
});

const render = (agent: boolean) =>
	renderToStaticMarkup(
		h(ProfileAvatarButton, {
			subject: { person, agent },
			label: agent ? "Nova (Owner)" : "Owner",
			onOpen: vi.fn(),
			testID: "profile-avatar-identity-probe",
		}),
	);

describe("profile avatar identity selection", () => {
	it("keeps the human account-photo path as a positive control", () => {
		expect(render(false)).toContain(OWNER_URI);
		expect(scope.avatars.peek).toHaveBeenCalledWith(OWNER_KEY);
	});

	it("an agent without its own image never borrows the owner's cached photo", () => {
		const html = render(true);
		expect(html).not.toContain(OWNER_URI);
		expect(scope.avatars.peek).not.toHaveBeenCalledWith(OWNER_KEY);
		expect(html).toContain('data-agent-glyph="true"');
		expect(scope.hub.avatarBytes).not.toHaveBeenCalled();
	});
});
