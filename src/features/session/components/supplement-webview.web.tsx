import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mintNonce } from "@/features/session/components/supplement-nonce";
import {
	acceptFrameMessage,
	COPY_FRAME_FALLBACK,
	COPY_RETRY,
	clampedHeightHint,
	clampFrameHeight,
	HOST_MESSAGE_TAG,
	PING_INTERVAL_MS,
	type SupplementComponent,
	type SupplementTheme,
	sourceLine,
	supplementFrameUrl,
	supplementGroundDocument,
	supplementThemeFor,
	WATCHDOG_MS,
} from "@/features/session/supplements";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import { Shimmer } from "@/ui/components";

/**
 * One generated component's sandboxed frame on the app's WEB build (the capture
 * and dev target; the native surface is `supplement-webview.tsx`, which this
 * file mirrors in semantics).
 *
 * WHY A WEB HOST EXISTS AT ALL. `react-native-webview` has no web
 * implementation (its fallback renders a red "does not support this platform"
 * notice), and the repo's whole visual-evidence pipeline — `tools/visual/
 * capture.ts`, the audit, the store screenshots — runs the exported web build.
 * A frame that cannot render there would leave the populated/theme-switch
 * captures hollow, so the web build gets the RELAY'S OWN delivery, ported:
 * `<iframe sandbox="allow-scripts" src="data:text/html;base64,…">`, the
 * messages wire, and the two controls the relay pair established —
 *
 *   - the EMBEDDING document's `frame-src data:` policy, declared as a
 *     `<meta http-equiv>` in `public/index.html` — spelled with the hyphen:
 *     camelCase `httpEquiv` is inert in raw HTML and applied no policy until
 *     QA round 1, Q1 (Chromium checks every navigation of an already-loaded
 *     child frame and blocks it before the request is issued); and
 *   - the `load` counter: the SECOND load is a hostile navigation or a blocked
 *     attempt (a blocked navigation fires a second `load` too), so the frame is
 *     torn down into the frame-level fallback line and every later message from
 *     it is dropped.
 *
 * THE DOWNLOAD CHANNEL (QA round 1, Q3; re-measured in the remediation
 * round, same build, Chrome 155). With the parent policy INERT — the
 * `httpEquiv` defect above — a `download`-attribute anchor click inside the
 * sandboxed frame issued a GET that neither the parent's `frame-src` nor the
 * document's `connect-src` governs: that was the measurement which showed the
 * policy is load-bearing. With the policy REPAIRED the same attempt is
 * blocked PRE-REQUEST (no `/dl` request leaves), and it ends the frame either
 * way — the belt when the click lands after the first `load`, the ping
 * watchdog when it lands during the initial parse. The download itself is
 * refused for lack of `allow-downloads`, and the request was uncredentialed;
 * the native WebView's download handling is platform-specific and owed a
 * device probe.
 *
 * The wire is the contract's, exactly as on native: the host sends
 * `{lo:"supplement-host", t:"theme", mode, vars, nonce}` and `{t:"ping"}`; it
 * accepts only `{lo:"supplement", v:1, t:"ready"|"resize"|"error"|"pong"}` —
 * with the nonce echoed on every state-moving type — from this frame's own
 * window at `Origin: "null"`, and clamps every height to [120, 480].
 *
 * WHAT THIS HOST DOES NOT HAVE, BY RULE: the bytes always ride the `data:` URL
 * (never a navigable relay URL), there is no bridge, and the document's own CSP
 * (which the served bytes carry) is in force.
 */
export type SupplementWebViewProps = {
	component: SupplementComponent;
	/** The assembled document, `null` until the relay route answers. The
	 *  reserved box holds the clamped `height_hint` while it is null. */
	documentHtml: string | null;
	/** The document could not be fetched: paint the fallback line rather than
	 *  hold the reserved box forever. */
	documentFailed?: boolean;
	/** The row's `supplement_restart` arm, offered as `· Retry` beside the
	 *  fallback line. Absent handler, absent control. */
	onRetry?: () => void;
	/** The frame's current rendered height, on every applied change — the
	 *  block's aggregate budget accrues these. */
	onHeightChange?: (height: number) => void;
};

/** The overflow the scroll-port walk treats as "this node scrolls". */
const AUTO_OR_SCROLL = /(auto|scroll)/;

/** The nearest scrollable ancestor, or null when the frame is not inside one.
 *  The resize gate needs it: a frame growing ABOVE the reader's scroll anchor
 *  moves what the reader is reading (§2.11), so such a growth is held and
 *  re-applied on the next scroll. */
function nearestScrollPort(element: HTMLElement): HTMLElement | null {
	let node: HTMLElement | null = element.parentElement;
	while (node) {
		const style = window.getComputedStyle(node);
		if (
			AUTO_OR_SCROLL.test(style.overflowY) &&
			node.scrollHeight > node.clientHeight
		) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

export const SupplementWebView = ({
	component,
	documentHtml,
	documentFailed = false,
	onRetry,
	onHeightChange,
}: SupplementWebViewProps) => {
	const { theme: themeName } = useTheme();
	const theme = useMemo(() => supplementThemeFor(themeName), [themeName]);
	const reserved = clampedHeightHint(component);
	const [height, setHeight] = useState(reserved);
	const [awaitingPaint, setAwaitingPaint] = useState(true);
	const [failed, setFailed] = useState(false);
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const nonceRef = useRef("");
	const failedRef = useRef(false);
	const loadCountRef = useRef(0);
	const heightRef = useRef(reserved);
	const pendingHeightRef = useRef<number | null>(null);
	const onHeightChangeRef = useRef(onHeightChange);
	onHeightChangeRef.current = onHeightChange;
	const themeRef = useRef(theme);
	themeRef.current = theme;

	const fail = useCallback(() => {
		if (failedRef.current) return;
		failedRef.current = true;
		setFailed(true);
	}, []);

	/*
	 * ARM THE WIRE, THEN NAVIGATE — one effect, and the order inside it is the
	 * point: a `data:` document begins executing in a task the browser may
	 * interleave before React's passive effects run, so a frame whose `src` were
	 * set during the commit could post `ready` into a page that is not listening
	 * yet — and since the prelude sends `ready` exactly once, the mount would then
	 * die at the boot deadline while the document is alive and painting. Assigning
	 * `src` from inside the armed effect closes that window by construction.
	 */
	useEffect(() => {
		if (documentHtml === null) return;
		const frameEl = frameRef.current;
		if (!frameEl) return;
		nonceRef.current = mintNonce();
		let live = false;
		let pingsStarted = false;
		let pingTimer: number | null = null;
		let pongDeadline: number | null = null;
		let raf: number | null = null;
		const coalesced: { resize: number | null; error: boolean } = {
			resize: null,
			error: false,
		};
		const bootDeadline = window.setTimeout(() => {
			if (!live) fail();
		}, WATCHDOG_MS);

		const post = (message: Record<string, unknown>) => {
			frameEl.contentWindow?.postMessage(message, "*");
		};
		const sendPing = () => {
			/* A FAILED frame is not pinged: the cadence belongs to a live document. */
			if (failedRef.current) return;
			if (pongDeadline !== null) return;
			post({ lo: HOST_MESSAGE_TAG, t: "ping" });
			pongDeadline = window.setTimeout(() => {
				pongDeadline = null;
				fail();
			}, WATCHDOG_MS);
		};
		/* The ping cadence starts WITH THE THEME PUSH, not at `ready`: a `pong` is
		 * nonce-required, the nonce only reaches the frame inside the theme message,
		 * and a ping sent at `ready` (which precedes that message) would be answered
		 * by a pong this host must reject. */
		const startPings = () => {
			if (pingsStarted || failedRef.current) return;
			pingsStarted = true;
			sendPing();
			pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
		};
		startPingsRef.current = startPings;

		const applyHeight = (next: number) => {
			/* The frame element is the box (the iframe fills it), and it is also the
			 * element the scroll-port hold measures: a growth whose top sits above the
			 * reader's scroll port is HELD and re-applied on the next scroll, so a
			 * late resize never moves what the reader is reading (§2.11). */
			const port = nearestScrollPort(frameEl);
			if (
				port !== null &&
				frameEl.getBoundingClientRect().top < port.getBoundingClientRect().top
			) {
				pendingHeightRef.current = next;
				onHeightChangeRef.current?.(next);
				return;
			}
			pendingHeightRef.current = null;
			onHeightChangeRef.current?.(next);
			if (next !== heightRef.current) {
				heightRef.current = next;
				setHeight(next);
			}
		};
		const scheduleCoalesced = () => {
			if (raf !== null) return;
			raf = window.requestAnimationFrame(() => {
				raf = null;
				const { resize, error } = coalesced;
				coalesced.resize = null;
				coalesced.error = false;
				if (error) {
					fail();
					return;
				}
				if (resize !== null) applyHeight(resize);
			});
		};

		const onMessage = (event: MessageEvent) => {
			/* The browsing-context binding: this frame's window at an opaque origin,
			 * then the contract's shape+nonce rule. */
			if (event.source !== frameEl.contentWindow) return;
			if (event.origin !== "null") return;
			const message = acceptFrameMessage(event.data, nonceRef.current);
			if (!message) return;
			if (message.t === "ready") {
				if (!live) {
					live = true;
					window.clearTimeout(bootDeadline);
				}
				return;
			}
			if (message.t === "pong") {
				if (pongDeadline !== null) {
					window.clearTimeout(pongDeadline);
					pongDeadline = null;
				}
				return;
			}
			if (message.t === "resize") {
				coalesced.resize = clampFrameHeight(message.h as number);
				setAwaitingPaint(false);
				scheduleCoalesced();
				return;
			}
			/* `error`: the frame's own report. One quiet line replaces it; the row
			 * is never rewritten (§2.8). */
			coalesced.error = true;
			scheduleCoalesced();
		};
		const onScroll = () => {
			const pending = pendingHeightRef.current;
			if (pending !== null) applyHeight(pending);
		};
		window.addEventListener("message", onMessage);
		/* Capture: the scroll that clears the hold happens on the transcript's own
		 * scroller, which does not bubble a scroll event to the window. */
		window.addEventListener("scroll", onScroll, true);

		/* ---- the wire is live; now the document may start ----
		 * The mount asserts the frame's ground in the bytes before the `data:`
		 * encoding (`supplementGroundDocument` — a live flip must keep the ground
		 * a palette token, design round 1, D1). */
		frameEl.src = supplementFrameUrl(supplementGroundDocument(documentHtml));

		return () => {
			window.clearTimeout(bootDeadline);
			if (pingTimer !== null) window.clearInterval(pingTimer);
			if (pongDeadline !== null) window.clearTimeout(pongDeadline);
			if (raf !== null) window.cancelAnimationFrame(raf);
			window.removeEventListener("message", onMessage);
			window.removeEventListener("scroll", onScroll, true);
			startPingsRef.current = () => {};
		};
	}, [documentHtml, fail]);

	/**
	 * The theme push. The FIRST push rides the frame's first `load` (the prelude
	 * installs its listener synchronously and stays hidden until a theme
	 * arrives); every later change is one more push, never a reload. The nonce
	 * rides the first push and is bound by the frame's first capture.
	 */
	const pushTheme = useCallback((next: SupplementTheme) => {
		frameRef.current?.contentWindow?.postMessage(
			{
				lo: HOST_MESSAGE_TAG,
				t: "theme",
				mode: next.mode,
				vars: next.vars,
				nonce: nonceRef.current,
			},
			"*",
		);
	}, []);
	const startPingsRef = useRef<() => void>(() => {});
	const pushThemeRef = useRef(pushTheme);
	pushThemeRef.current = pushTheme;
	useEffect(() => {
		if (loadCountRef.current > 0 && !failedRef.current) pushTheme(theme);
	}, [theme, pushTheme]);

	const onLoad = useCallback(() => {
		const count = loadCountRef.current + 1;
		loadCountRef.current = count;
		if (count > 1) {
			/* The second load is a hostile navigation OR a blocked attempt. Either
			 * way this frame is not the document the host mounted. */
			fail();
			return;
		}
		pushThemeRef.current(themeRef.current);
		/* The theme push is what delivers the nonce, so the ping cadence starts
		 * here — any earlier ping would fail a live frame five seconds later. */
		startPingsRef.current();
	}, [fail]);

	if (failed || documentFailed) {
		return (
			<View
				className="flex-row flex-wrap items-center gap-1"
				testID={SURFACE.supplementFrameFallback}
			>
				<Text className="text-meta text-ink-dim">{COPY_FRAME_FALLBACK}</Text>
				{onRetry ? (
					<>
						<Text className="text-meta text-ink-dim" aria-hidden>
							·
						</Text>
						<Pressable
							accessibilityRole="button"
							className="min-h-11 justify-center px-1"
							testID={CONTROL.supplementRetry}
							onPress={onRetry}
						>
							<Text className="text-meta text-ink-dim">{COPY_RETRY}</Text>
						</Pressable>
					</>
				) : null}
			</View>
		);
	}

	return (
		<View className="flex-col gap-1">
			<View
				className="overflow-hidden rounded-sm"
				style={{ height }}
				testID={SURFACE.supplementFrame}
			>
				{documentHtml !== null ? (
					<iframe
						ref={frameRef}
						title={component.title}
						sandbox="allow-scripts"
						onLoad={onLoad}
						style={{
							display: "block",
							height: "100%",
							width: "100%",
							border: 0,
						}}
					/>
				) : null}
				{awaitingPaint && documentHtml !== null ? (
					<Shimmer active className="absolute inset-0">
						<View className="h-full w-full bg-elevated" />
					</Shimmer>
				) : null}
			</View>
			<Text
				className="text-meta text-ink-muted"
				numberOfLines={1}
				testID={SURFACE.supplementSource}
			>
				{sourceLine(component.source)}
			</Text>
		</View>
	);
};
