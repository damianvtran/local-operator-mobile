/**
 * The commands the own-tunnel path shows, as data.
 *
 * **Verified, not invented.** Every `lop` command here is the one the CLI itself
 * documents: the subcommand list is `install`, `status`, `start|stop|restart`,
 * `logs`, `password`, `uninstall`, `serve` (`local_operator/cli.py` § mobile), and
 * the daemon's own install output names the port and the portal password
 * (`install`: "open http://127.0.0.1:4098 and sign in with your portal password").
 * `LOP_MOBILE_PASSWORD` is the private-environment spelling from `docs/mobile.md`.
 *
 * The two tunnel commands are third-party, so they are verified differently:
 * `cloudflared tunnel --url <URL>` is checked against the installed binary
 * ("Connect to the local webserver at URL", cloudflared 2026.7.3). `ngrok http
 * <port>` is the documented ngrok form and is NOT verified on this machine —
 * ngrok is not installed here — which the PR says rather than implying otherwise.
 *
 * **Keys, not text (M3 S2b-1).** The labels and notes are catalogue KEYS, rendered
 * by `tunnelCommandLabel`/`tunnelCommandNote` at render time: a module constant
 * holding `t()` output would freeze the language at import. The commands, the
 * loopback address and the URL scheme are never translated, so they stay here and
 * reach the sentences as `{address}`/`{scheme}` placeholders; the two tunnel
 * labels are product names (Cloudflare, ngrok) and stay literal.
 *
 * There is deliberately no bare `lop mobile`: the brief asked for it, the CLI has
 * no such command (a bare `lop mobile` prints help), and copy that names a command
 * the reader cannot run is worse than copy that names two they can.
 */

import { t } from "@/i18n";

/** The loopback address and port the relay serves; a value, never copy. */
const RELAY_LOOPBACK = "127.0.0.1:4098";
/** The scheme a tunnel prints; a value, never copy. */
const PUBLIC_SCHEME = "https://";

type TunnelLabel =
	| {
			key:
				| "mobile.computers.own_tunnel.install_label"
				| "mobile.computers.own_tunnel.foreground_label"
				| "mobile.computers.own_tunnel.check_label"
				| "mobile.computers.own_tunnel.rotate_label";
	  }
	/** A product name, which is never translated. */
	| { product: string };

type TunnelNoteKey =
	| "mobile.computers.own_tunnel.install_note"
	| "mobile.computers.own_tunnel.foreground_note"
	| "mobile.computers.own_tunnel.check_note"
	| "mobile.computers.own_tunnel.rotate_note"
	| "mobile.computers.own_tunnel.cloudflare_note"
	| "mobile.computers.own_tunnel.ngrok_note";

export interface TunnelCommand {
	/** Stable, never-translated identity: the copy control's test ID derives from
	 *  it (`tunnelCommandCopyId`). It is the slug of the English label the screen
	 *  first shipped with, which keeps those IDs byte-identical. */
	id: string;
	/** The step's own label, in the shortest true words. */
	label: TunnelLabel;
	/** One sentence about what it does, or what to expect. */
	note: TunnelNoteKey;
	/** The exact text, ready to copy. */
	command: string;
	/** Which platform it belongs to, or `null` for all of them. */
	platform: "macos" | "other";
}

/** Preparation on the computer, in the order it has to happen. */
export const COMPUTER_COMMANDS: readonly TunnelCommand[] = [
	{
		id: "install-on-the-computer",
		label: { key: "mobile.computers.own_tunnel.install_label" },
		note: "mobile.computers.own_tunnel.install_note",
		command: "lop mobile install",
		platform: "macos",
	},
	{
		id: "or-run-it-in-the-foreground",
		label: { key: "mobile.computers.own_tunnel.foreground_label" },
		note: "mobile.computers.own_tunnel.foreground_note",
		command: "LOP_MOBILE_PASSWORD=... lop mobile serve",
		platform: "other",
	},
	{
		id: "check-it",
		label: { key: "mobile.computers.own_tunnel.check_label" },
		note: "mobile.computers.own_tunnel.check_note",
		command: "lop mobile status",
		platform: "other",
	},
	{
		id: "set-or-rotate-the-password",
		label: { key: "mobile.computers.own_tunnel.rotate_label" },
		note: "mobile.computers.own_tunnel.rotate_note",
		command: "lop mobile password",
		platform: "other",
	},
];

/** The tunnel itself. Both examples forward a public HTTPS URL to loopback. */
export const TUNNEL_COMMANDS: readonly TunnelCommand[] = [
	{
		id: "cloudflare",
		label: { product: "Cloudflare" },
		note: "mobile.computers.own_tunnel.cloudflare_note",
		command: "cloudflared tunnel --url http://127.0.0.1:4098",
		platform: "other",
	},
	{
		id: "ngrok",
		label: { product: "ngrok" },
		note: "mobile.computers.own_tunnel.ngrok_note",
		command: "ngrok http 4098",
		platform: "other",
	},
];

/** The step's label in the reader's language (or the product's own name). */
export const tunnelCommandLabel = (item: TunnelCommand): string =>
	"key" in item.label ? t(item.label.key) : item.label.product;

/** The step's note in the reader's language, with the values it names. Spelled
 *  per key so the typed `t()` overloads check each message's own parameters. */
export const tunnelCommandNote = (item: TunnelCommand): string => {
	switch (item.note) {
		case "mobile.computers.own_tunnel.foreground_note":
			return t(item.note, { address: RELAY_LOOPBACK });
		case "mobile.computers.own_tunnel.cloudflare_note":
		case "mobile.computers.own_tunnel.ngrok_note":
			return t(item.note, { scheme: PUBLIC_SCHEME });
		default:
			return t(item.note);
	}
};

/** The rule behind the two examples, for a reader whose provider is neither. */
export const tunnelRule = (): string =>
	t("mobile.computers.own_tunnel.tunnel_rule", { address: RELAY_LOOPBACK });
