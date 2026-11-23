import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Design review round 2, D12 (MINOR): a community-only reader (no private org,
 * `case=plan_required`) opened the switcher and saw "ORGANIZATIONS", a hairline,
 * then "COMMUNITIES": an empty first group reads as a failed load. The heading
 * now needs rows under it as well as the community flag. Rendered with the real
 * react-native-web host; only providers and native-only leaves are stubbed.
 */
const host = vi.hoisted(() => ({
	communityOn: true,
	organizations: [] as { tenantId: string; name: string; unread?: number }[],
}));

vi.mock("@/community/flag", () => ({
	communityEnabled: () => host.communityOn,
}));
vi.mock("@/community/provider", () => ({
	useCommunity: () => ({ actions: { select: vi.fn() } }),
	useCommunityState: <T,>(select: (s: { session: null }) => T) =>
		select({ session: null }),
}));
vi.mock("@/team-bridge/provider", () => ({
	useTeamBridge: () => ({ actions: { selectOrganization: vi.fn() } }),
	useTeamBridgeState: <T,>(
		select: (s: {
			organizations: typeof host.organizations;
			selectedTenantId: string | null;
		}) => T,
	) => select({ organizations: host.organizations, selectedTenantId: null }),
}));
/* Native-only leaves (lucide, expo-router, uniwind) Node cannot parse; markers
 * keep the structure under test visible. */
vi.mock("@/features/community/parts", () => ({ SwitcherTrailing: () => null }));
vi.mock("@/features/community/switcher-group", () => ({
	CommunitySwitcherGroup: () => h("i", { "data-group": "communities" }),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
vi.mock("@/ui/direction", () => ({ useComposedDir: () => ({}) }));
vi.mock("@/ui/components/sheet", () => ({
	Sheet: ({ children }: { children?: ReactNode }) =>
		h("section", null, children),
}));
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: ({ label }: { label: string }) =>
		h("h2", { "data-heading": label }),
}));

const { t } = await import("@/i18n");
const { OrgSwitcherSheet } = await import("./org-switcher-sheet");

const render = () =>
	renderToStaticMarkup(
		h(OrgSwitcherSheet, { visible: true, onClose: () => {} }),
	);
const heading = () =>
	`data-heading="${t("mobile.community.switcher.organizations")}"`;

beforeEach(() => {
	host.communityOn = true;
	host.organizations = [];
});

describe("OrgSwitcherSheet organizations heading (D12)", () => {
	it("hides the heading for a community-only reader with no private org", () => {
		const html = render();
		expect(html).not.toContain(heading());
		expect(html).toContain('data-group="communities"');
	});

	it("shows the heading over private orgs when communities are on", () => {
		host.organizations = [{ tenantId: "t1", name: "Example Org" }];
		const html = render();
		expect(html).toContain(heading());
		expect(html).toContain("Example Org");
	});

	it("keeps no heading when communities are off (one group needs none)", () => {
		host.communityOn = false;
		host.organizations = [{ tenantId: "t1", name: "Example Org" }];
		expect(render()).not.toContain(heading());
	});
});
