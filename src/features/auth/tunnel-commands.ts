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
 * There is deliberately no bare `lop mobile`: the brief asked for it, the CLI has
 * no such command (a bare `lop mobile` prints help), and copy that names a command
 * the reader cannot run is worse than copy that names two they can.
 */

export interface TunnelCommand {
	/** The step's own label, in the shortest true words. */
	label: string;
	/** One sentence about what it does, or what to expect. */
	note: string;
	/** The exact text, ready to copy. */
	command: string;
	/** Which platform it belongs to, or `null` for all of them. */
	platform: "macos" | "other";
}

/** Preparation on the computer, in the order it has to happen. */
export const COMPUTER_COMMANDS: readonly TunnelCommand[] = [
	{
		label: "Install on the computer",
		note: "macOS: writes the supervised daemon, generates the portal password and keeps it in your keychain.",
		command: "lop mobile install",
		platform: "macos",
	},
	{
		label: "Or run it in the foreground",
		note: "Any other platform, or when you would rather watch the log. It serves 127.0.0.1:4098, loopback only.",
		command: "LOP_MOBILE_PASSWORD=... lop mobile serve",
		platform: "other",
	},
	{
		label: "Check it",
		note: "Health, the state of the auth gate, and the sessions the phone will see.",
		command: "lop mobile status",
		platform: "other",
	},
	{
		label: "Set or rotate the password",
		note: "Asks you interactively, so the value never reaches a shell history or a process list. This is the password the app asks for below.",
		command: "lop mobile password",
		platform: "other",
	},
];

/** The tunnel itself. Both examples forward a public HTTPS URL to loopback. */
export const TUNNEL_COMMANDS: readonly TunnelCommand[] = [
	{
		label: "Cloudflare",
		note: "Free and needs no account for a quick tunnel. It prints the https:// URL to paste below.",
		command: "cloudflared tunnel --url http://127.0.0.1:4098",
		platform: "other",
	},
	{
		label: "ngrok",
		note: "Needs an ngrok account. It prints the https:// URL to paste below.",
		command: "ngrok http 4098",
		platform: "other",
	},
];

/** The rule behind the two examples, for a reader whose provider is neither. */
export const TUNNEL_RULE =
	"Any tunnel works as long as it forwards a public HTTPS URL to 127.0.0.1:4098 on that computer.";
