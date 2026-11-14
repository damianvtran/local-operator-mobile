// SCRATCH ONLY — the M1 evidence route, dropped untracked into app/(auth)/ for
// the capture and deleted afterwards; never committed to the product tree.
// It feeds the SAME inputs through the tree's own `refusalFromError` and renders
// the tree's own `RefusalSurface` / `SetupComputer` inside the real root layout,
// so the base (d5831603) and head frames differ only by the product change.
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { TunnelSessionError } from "@/connection/tunnel-session";
import { refusalFromError, tunnelSessionRelayError } from "@/features/auth/refusal";
import { SetupComputer } from "@/features/auth/setup-computer";
import { RelayError, relayErrorFromResponse } from "@/relay";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { connectionStore } from "@/features/auth/connection-provider";
import Settings from "@/features/settings/settings";

const gateway = (body: Record<string, string>) =>
	relayErrorFromResponse({ status: 503, header: () => "application/json", text: JSON.stringify(body) });

const row = (active: boolean | null, eligible: boolean | null, rawStatus: string) => ({
	billing: { active, eligible, message: null },
	rawStatus,
});
const mint = (failure: "disabled" | "network") =>
	tunnelSessionRelayError(new TunnelSessionError(failure, "tunnel is unavailable", failure === "disabled" ? 403 : undefined));
const CASES: Record<string, () => { error: RelayError; computer: ReturnType<typeof row> | null }> = {
	"phone-access-off": () => ({ error: mint("disabled"), computer: row(false, false, "suspended") }),
	"balance-out": () => ({ error: mint("disabled"), computer: row(true, false, "suspended") }),
	suspended: () => ({ error: mint("disabled"), computer: row(true, true, "suspended") }),
	"console-disabled": () => ({ error: mint("disabled"), computer: row(true, true, "disabled") }),
	provisioning: () => ({ error: mint("disabled"), computer: row(true, true, "reconciling") }),
	"computer-offline": () => ({ error: new RelayError("computer-offline", "Tunnel temporarily unavailable"), computer: null }),
	"relay-stopped": () => ({ error: new RelayError("relay-down", "local harness unavailable"), computer: null }),
	"tunnel-gone": () => ({ error: new RelayError("unknown-tunnel", "unknown tunnel"), computer: null }),
	"radient-unreachable": () => ({ error: mint("network"), computer: null }),
	"reason-billing-lapsed": () => ({ error: gateway({ detail: "d", reason: "billing_lapsed", error: "e" }), computer: null }),
	"reason-server-unavailable": () => ({ error: gateway({ detail: "d", reason: "server_unavailable", kind: "wait_radient", error: "e" }), computer: null }),
	"kind-wait-network": () => ({ error: gateway({ detail: "d", reason: "control_plane_unreachable", kind: "wait_network", error: "e" }), computer: null }),
	"kind-sign-in": () => ({ error: gateway({ detail: "d", reason: "login_required", kind: "sign_in", error: "e" }), computer: null }),
	"kind-open-console": () => ({ error: gateway({ detail: "d", reason: "tunnel_not_authorized", kind: "open_console", error: "e" }), computer: null }),
	"relay-wait": () => ({
		error: relayErrorFromResponse({ status: 503, header: () => "application/json", text: JSON.stringify({ kind: "wait_relay_starting" }) }),
		computer: null,
	}),
};

export default function Evidence() {
	const { state } = useLocalSearchParams<{ state?: string }>();
	if (state === "settings") {
		/* Seed only what Diagnostics reads; the provider is not asked to connect. */
		connectionStore.setState({
			route: { mode: "radient", hostname: "0123456789abcdef0123456789abcdef-lop.example.com", tunnelId: "0123456789abcdef0123456789abcdef" },
			tunnelId: "0123456789abcdef0123456789abcdef",
		} as never);
		return <Settings />;
	}
	if (state === "setup")
		return (
			<Screen title="Computers">
				<SetupComputer billing={null} onWaitForConnector={() => {}} waiting={false} />
			</Screen>
		);
	const made = (CASES[state ?? ""] ?? CASES["computer-offline"])();
	const view = refusalFromError({
		error: made.error,
		surface: made.error.surface,
		detail: made.error.detail ?? null,
		retryAfterMs: null,
		subject: "Studio Mac",
		computer: made.computer,
	} as never);
	return (
		<Screen title="Computers">
			<View testID="m1-evidence">
				{view ? (
					<RefusalSurface
						{...(view as never as Record<string, never>)}
						onRetry={() => {}}
						onSignIn={() => {}}
						onOpenConsole={() => {}}
						onRefreshList={() => {}}
						onOpenUrl={() => {}}
					/>
				) : null}
			</View>
		</Screen>
	);
}
