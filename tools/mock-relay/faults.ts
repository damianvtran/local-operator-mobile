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
 *
 * `FAULT_SPECS` is the single source of truth for what exists: the CLI help, the
 * docs table and `verify.ts`'s coverage check all read it, so a fault added here
 * without an assertion in the verifier fails the verifier rather than shipping
 * unexercised.
 */

/** Default gap for `--fault split-chunks`, in milliseconds. */
const CHUNK_GAP_MS = 40;

/** The faults that affect the event stream. */
export interface StreamFaults {
	/** Clean end-of-body after N seconds: the gateway's `MAX_STREAM_SECONDS`. */
	cutAfterS: number | undefined;
	/** Destroy the socket in the middle of a frame, so the client sees a torn event. */
	dropMidFrame: boolean;
	/** Write each frame in two writes with a gap, so `data:` and the terminator split across reads. */
	splitChunks: boolean;
	chunkGapMs: number;
	/** Emit a frame carrying an older `version` after a newer one. */
	staleVersion: boolean;
	/** Send the seed then go quiet: no keep-alives, no frames. */
	silentAfterSeed: boolean;
	/** Never send a seed at all — the stream opens and says nothing. */
	noSeed: boolean;
	/** Reject the next request with an edge 401 after N seconds of streaming. */
	expireAfterS: number | undefined;
}

/** The faults that affect plain HTTP responses. */
export interface HttpFaults {
	/** Delay every response by N ms. */
	delayMs: number;
	/** Body ceiling to enforce; `undefined` means the route's own limit applies. */
	oversizeLimit: number | undefined;
	/** Refuse every request with this gateway failure key or `503-<reason>`. */
	refuseWith: string | undefined;
}

/** The faults that affect the command endpoint's acknowledgement. */
export interface CommandFaults {
	/** Deliver the same command frame twice on the stream, so the client's dedup is what is under test. */
	duplicateDelivery: boolean;
	/** Accept the command, never acknowledge it, then answer 504 (the ambiguous case). */
	noAck: boolean;
	/** Accept the command and never answer at all. */
	noAckForever: boolean;
	/** Hold the request open this long before the 504. */
	noAckAfterMs: number;
}

/** One parsed `--fault` set. */
export interface FaultSet {
	sse: StreamFaults;
	http: HttpFaults;
	command: CommandFaults;
	/** The raw `--fault` strings, in order, for the record header and the report. */
	applied: string[];
}

/**
 * One fault, as a machine-readable fact.
 *
 * `invocation` is what a verifier should pass to reproduce it quickly — a
 * defaulted parameter is spelled out where the default is not test-sized (a
 * 60-second stream, or a 10 MiB body).
 */
export interface FaultSpec {
	/** The canonical flag value, with a short parameter when it takes one. */
	invocation: string;
	/** The canonical name alone, as `parseFaults` accepts it. */
	name: string;
	/** What the fault must do, in one line, as the verifier asserts it. */
	effect: string;
	/** True when the name is a family the verifier must expand from the corpus. */
	family?: "detail" | "gateway";
}

const spec = (name: string): { name: string; value: string | undefined } => {
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
export function parseFaults(names: string[] = []): FaultSet {
	const out: FaultSet = {
		sse: {
			cutAfterS: undefined,
			dropMidFrame: false,
			splitChunks: false,
			chunkGapMs: CHUNK_GAP_MS,
			staleVersion: false,
			silentAfterSeed: false,
			noSeed: false,
			expireAfterS: undefined,
		},
		http: {
			delayMs: 0,
			oversizeLimit: undefined,
			refuseWith: undefined,
		},
		command: {
			duplicateDelivery: false,
			noAck: false,
			noAckForever: false,
			noAckAfterMs: 15_000,
		},
		applied: [],
	};

	for (const raw of names) {
		const { name, value } = spec(raw);
		const numeric = value === undefined ? undefined : Number(value);
		switch (name) {
			// The 60 s gateway cap. Default matches `MAX_STREAM_SECONDS` so a caller
			// can write `--fault sse-cut-after` and get the real thing.
			case "sse-cut-after":
				out.sse.cutAfterS =
					numeric === undefined || !Number.isFinite(numeric) ? 60 : numeric;
				break;
			case "sse-drop-mid-stream":
				out.sse.dropMidFrame = true;
				break;
			case "split-chunks":
			case "sse-split-chunks":
				out.sse.splitChunks = true;
				if (numeric !== undefined && Number.isFinite(numeric))
					out.sse.chunkGapMs = numeric;
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
				out.sse.expireAfterS =
					numeric === undefined || !Number.isFinite(numeric) ? 10 : numeric;
				break;
			case "slow-response":
			case "slow":
				out.http.delayMs =
					numeric === undefined || !Number.isFinite(numeric) ? 500 : numeric;
				break;
			case "413-oversize":
				// The mechanism is the gateway's own pre-flight body check; only the
				// threshold is test-sized, because allocating the real 10 MiB ceiling's
				// worth of body on every run of an audit matrix is waste. Pass a value to
				// pin the real one: `--fault 413-oversize=10485760`.
				out.http.oversizeLimit =
					numeric === undefined || !Number.isFinite(numeric)
						? 64 * 1024
						: numeric;
				break;
			case "duplicate-delivery":
				out.command.duplicateDelivery = true;
				break;
			case "no-ack":
				out.command.noAck = true;
				if (numeric !== undefined && Number.isFinite(numeric))
					out.command.noAckAfterMs = numeric;
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
					`unknown fault: '${name}'. Known: ${FAULT_SPECS.map((f) => f.invocation).join(", ")}`,
				);
			}
		}
		out.applied.push(raw);
	}
	return out;
}

/**
 * Every fault the layer implements, as the facts a verifier iterates.
 *
 * The two families at the end are expanded from the captured corpus rather than
 * listed here: `503-<reason>` must cover *every* `RELAY_DETAIL` reason the relay
 * can produce, and the list of reasons is the corpus's, not this file's.
 */
export const FAULT_SPECS: readonly FaultSpec[] = [
	{
		name: "sse-cut-after",
		invocation: "sse-cut-after=2",
		effect: "the stream ends cleanly, with no error frame, after ~2 s",
	},
	{
		name: "sse-drop-mid-stream",
		invocation: "sse-drop-mid-stream",
		effect:
			"the socket is destroyed inside a frame, so the client sees a torn event",
	},
	{
		name: "split-chunks",
		invocation: "split-chunks=40",
		effect:
			"a frame's bytes arrive in two reads, split across the `data:` payload",
	},
	{
		name: "stale-version",
		invocation: "stale-version",
		effect: "a frame carrying an older `version` arrives after a newer one",
	},
	{
		name: "silent-stall",
		invocation: "silent-stall",
		effect:
			"the stream opens and seeds, then sends nothing at all — no frames, no keep-alives — without ending",
	},
	{
		name: "no-seed",
		invocation: "no-seed",
		effect:
			"the stream opens without its seed snapshot; later frames still flow, so the client must render without an initial projection",
	},
	{
		name: "401-mid-session",
		invocation: "401-mid-session=1",
		effect: "a request is refused with the edge's 401 after the stream is up",
	},
	{
		name: "slow-response",
		invocation: "slow-response=300",
		effect: "a plain response is delayed by ~300 ms",
	},
	{
		name: "413-oversize",
		invocation: "413-oversize",
		effect: "a body over the ceiling is refused with the gateway's 413",
	},
	{
		name: "duplicate-delivery",
		invocation: "duplicate-delivery",
		effect:
			"the accepted command's frame is delivered twice, byte-identical, so dedup is what is under test",
	},
	{
		name: "no-ack",
		invocation: "no-ack=1200",
		effect:
			"the command is admitted then answered 504 after ~1.2 s, and a retry gets `already admitted`",
	},
	{
		name: "no-ack-forever",
		invocation: "no-ack-forever",
		effect:
			"the command is admitted and never answered, and a retry still gets `already admitted`",
	},
	{
		name: "503-<reason>",
		invocation: "503-<reason>",
		effect:
			"every captured `RELAY_DETAIL` reason is refused with its own 503 body",
		family: "detail",
	},
	{
		name: "gateway-<key>",
		invocation: "gateway-<key>",
		effect: "every captured gateway failure body is served verbatim",
		family: "gateway",
	},
];

/** The bare names a verifier can parse, families included. */
export const FAULT_NAMES: readonly string[] = FAULT_SPECS.map((f) => f.name);

/** True when a fault set changes what a mutating request does, for the record header. */
export const summariseFaults = (faults: FaultSet): string =>
	faults.applied.length === 0 ? "none" : faults.applied.join(",");
