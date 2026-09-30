/**
 * The fault layer: real adversities, injected deterministically.
 *
 * Scenarios answer "what state is the relay in"; faults answer "what goes wrong
 * on the wire while it is in that state". The distinction matters because the
 * expensive client bugs live in the second question — a stream cut at the
 * gateway's 60 s cap, a frame split across TCP chunks, a duplicate command, or
 * a command the relay accepted and never acknowledged (the case the retry
 * envelope exists for).
 *
 * Every fault is a *value*, so it is reproducible: the same `--fault` list
 * always produces the same bytes in the same order, with no timing race beyond
 * the delays that are themselves parameters. Nothing here is random.
 */

/** Default gap for `--fault split-chunks`, in milliseconds. */
const CHUNK_GAP_MS = 40;

const spec = (name) => {
	const eq = name.indexOf("=");
	return eq === -1
		? { name, value: undefined }
		: { name: name.slice(0, eq), value: name.slice(eq + 1) };
};

/**
 * Resolve a list of fault names into one descriptor the server reads.
 * Unknown names are rejected rather than ignored: a typo that silently
 * disables a fault turns a passing run into a meaningless one.
 */
export function parseFaults(names = []) {
	const out = {
		sse: {
			/** Clean end-of-body after N seconds: the gateway's `MAX_STREAM_SECONDS`. */
			cutAfterS: undefined,
			/** Destroy the socket in the middle of a frame, so the client sees a torn event. */
			dropMidFrame: false,
			/** Write each frame in two writes with a gap, so `data:` and the terminator split across reads. */
			splitChunks: false,
			chunkGapMs: CHUNK_GAP_MS,
			/** Emit a frame carrying an older `version` after a newer one. */
			staleVersion: false,
			/** Send the seed then go quiet: no keep-alives, no frames. */
			silentAfterSeed: false,
			/** Never send a seed at all — the stream opens and says nothing. */
			noSeed: false,
			/** Reject the next request with an edge 401 after N seconds of streaming. */
			expireAfterS: undefined,
		},
		http: {
			/** Delay every response by N ms. */
			delayMs: 0,
			/** Body ceiling to enforce; `undefined` means the route's own limit applies. */
			oversizeLimit: undefined,
			/** Refuse every request with this gateway failure key or `503-<reason>`. */
			refuseWith: undefined,
		},
		command: {
			/** Deliver the same command twice and prove the client's dedup: one row, `already admitted`. */
			duplicateDelivery: false,
			/** Accept the command, never acknowledge it, then answer 504 (the ambiguous case). */
			noAck: false,
			/** Accept the command and never answer at all. */
			noAckForever: false,
			/** Hold the request open this long before the 504. */
			noAckAfterMs: 15_000,
		},
	};

	const applied = [];
	for (const raw of names) {
		const { name, value } = spec(raw);
		const numeric = value === undefined ? undefined : Number(value);
		switch (name) {
			// The 60 s gateway cap. Default matches `MAX_STREAM_SECONDS` so a caller
			// can write `--fault sse-cut-after` and get the real thing.
			case "sse-cut-after":
				out.sse.cutAfterS = Number.isFinite(numeric) ? numeric : 60;
				break;
			case "sse-drop-mid-stream":
				out.sse.dropMidFrame = true;
				break;
			case "split-chunks":
			case "sse-split-chunks":
				out.sse.splitChunks = true;
				if (Number.isFinite(numeric)) out.sse.chunkGapMs = numeric;
				break;
			case "stale-version":
			case "out-of-order-version":
				out.sse.staleVersion = true;
				break;
			case "silent-stall":
				out.sse.silentAfterSeed = true;
				break;
			case "no-seed":
				out.sse.noSeed = true;
				break;
			case "401-mid-session":
				out.sse.expireAfterS = Number.isFinite(numeric) ? numeric : 10;
				break;
			case "slow-response":
			case "slow":
				out.http.delayMs = Number.isFinite(numeric) ? numeric : 500;
				break;
			case "413-oversize":
				// The mechanism is the gateway's own pre-flight body check; only the
				// threshold is test-sized, because allocating the real 10 MiB ceiling's
				// worth of body on every run of an audit matrix is waste. Pass a value to
				// pin the real one: `--fault 413-oversize=10485760`.
				out.http.oversizeLimit = Number.isFinite(numeric) ? numeric : 64 * 1024;
				break;
			case "duplicate-delivery":
				out.command.duplicateDelivery = true;
				break;
			case "no-ack":
				out.command.noAck = true;
				if (Number.isFinite(numeric)) out.command.noAckAfterMs = numeric;
				break;
			case "no-ack-forever":
				out.command.noAckForever = true;
				break;
			default: {
				// `--fault 503-<reason>` and the gateway's other bodies are faults
				// applied mid-session, so a run can stream first and then be refused.
				if (name.startsWith("503-") || name.startsWith("gateway-")) {
					out.http.refuseWith = name.replace(/^gateway-/, "");
					break;
				}
				throw new Error(
					`unknown fault: '${name}'. Known: sse-cut-after[=s], sse-drop-mid-stream, `
					+ "split-chunks[=ms], stale-version, silent-stall, no-seed, 401-mid-session[=s], "
					+ "slow-response[=ms], 413-oversize, duplicate-delivery, no-ack[=ms], "
					+ "no-ack-forever, 503-<reason>, gateway-<key>",
				);
			}
		}
		applied.push(raw);
	}
	out.applied = applied;
	return out;
}

/** Every fault in one list, for `--help` and the docs table. */
export const FAULT_NAMES = [
	"sse-cut-after[=<seconds>]",
	"sse-drop-mid-stream",
	"split-chunks[=<ms>]",
	"stale-version",
	"silent-stall",
	"no-seed",
	"401-mid-session[=<seconds>]",
	"slow-response[=<ms>]",
	"413-oversize",
	"duplicate-delivery",
	"no-ack[=<ms>]",
	"no-ack-forever",
	"503-<reason>",
	"gateway-<key>",
];

/** True when a fault set changes what a mutating request does, for the record header. */
export const summariseFaults = (faults) => (faults.applied.length === 0 ? "none" : faults.applied.join(","));
