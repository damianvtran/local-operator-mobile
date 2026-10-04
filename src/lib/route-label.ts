import { type RouteProfile, routeLabel } from "@/connection";

/**
 * The header's label: what this app is looking at.
 *
 * Three honest cases, and the third is the one that matters: a custom route has
 * no account and no computer list, so calling it "Connect a computer" on an
 * already-connected relay would be a lie the reader cannot act on.
 *
 * It lives in `lib/` because THREE surfaces read it now — the home header's
 * computer name, the conversations pane's switcher row, and the avatar's
 * initials — and a second copy of this ladder is how two headers end up naming
 * one machine differently.
 */
export function listLabel(
	computers: readonly { tunnelId: string; name: string }[],
	tunnelId: string | null,
	route: RouteProfile | null,
): string {
	const active = computers.find((computer) => computer.tunnelId === tunnelId);
	if (active) return active.name;
	if (route?.mode === "custom") return routeLabel(route);
	if (route?.mode === "radient") return "Choose a computer";
	return "Connect a computer";
}
