import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import WebView from "react-native-webview";
/* The event types are not re-exported by the package root (only `WebView`
 * is), so they come from the module that declares them — the shape the
 * library's own docs use. */
import type {
	ShouldStartLoadRequest,
	WebViewMessageEvent,
} from "react-native-webview/lib/WebViewTypes";
import { mintNonce } from "@/features/session/components/supplement-nonce";
import {
	acceptFrameMessage,
	COPY_FRAME_FALLBACK,
	COPY_RETRY,
	clampedHeightHint,
	clampFrameHeight,
	HOST_MESSAGE_TAG,
	hostMessageScript,
	nativeSupplementDocument,
	PING_INTERVAL_MS,
	type SupplementComponent,
	type SupplementTheme,
	sourceLine,
	supplementGroundDocument,
	supplementThemeFor,
	WATCHDOG_MS,
} from "@/features/session/supplements";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import { Shimmer } from "@/ui/components";

/**
 * One generated component in its sandboxed WebView (turn-supplements memo
 * §4.1/§4.2, lane N).
 *
 * THE INVARIANT, and every prop below is part of it:
 *
 *   - `source={{html, baseUrl:"about:blank"}}` — the bytes the relay's read
 *     route returned, mounted as the WebView's own top-level document, whose
 *     base is `about:blank`. Nothing ever navigates to a URL: the document
 *     travels as JSON from the relay (`features/session/relay`), so a hostile
 *     component cannot address a `text/html` route and the host cannot be
 *     made to load one;
 *   - no bridge: no `injectedJavaScript`/`injectedJavaScriptBeforeContentLoaded`
 *     prop, no `onMessage` object surface. `window.ReactNativeWebView` is the
 *     LIBRARY's channel (the frame's own outbound posts ride it through the
 *     native shim, `nativeSupplementDocument`), and the only thing the host
 *     accepts on it is the contract's four frame messages, nonce-gated for the
 *     three that move host state (`acceptFrameMessage`);
 *   - `originWhitelist={["*"]}` — DELIBERATELY not the design sketch's
 *     `["about:*"]`, because of the trap probe P4 documents: this library's
 *     whitelist check HANDS every non-matching URL to the operating system
 *     (`Linking.openURL`, `WebViewShared.tsx` `createOnShouldStartLoadWithRequest`)
 *     instead of consulting the one-shot guard — so an `["about:*"]` list would
 *     turn a hostile self-navigation into an OS browser popup, the exact
 *     outcome the memo forbids. Admitting everything makes the one-shot guard
 *     the only decision point for every navigation, and the guard denies all of
 *     them (`onShouldStartLoadWithRequest` below);
 *   - `incognito`, `sharedCookiesEnabled={false}`, `thirdPartyCookiesEnabled={false}`:
 *     the WebView holds no credential of the app's. The relay credential is set
 *     per-fetch by the app (probe P5 tracks whether `incognito` still shares the
 *     platform cookie jar on the custom route — these two flags are the belt
 *     either way);
 *   - `allowFileAccess={false}`, `allowUniversalAccessFromFileURLs={false}`:
 *     file URLs and file-origin universal access are off (Android; the
 *     library's own defaults already deny the latter, this makes it explicit and
 *     survives a library default change);
 *   - `setSupportMultipleWindows={false}`: `window.open` cannot spawn a second
 *     window (Android), and `onOpenWindow` carries the iOS half — see the
 *     handler's own comment;
 *   - EVERYTHING HERE IS PER MOUNT. The nonce, the load counter, the boot
 *     deadline and the ping cadence live in this instance (refs, one cleanup
 *     effect): two components on one screen are two independently bounded
 *     frames, and one frame's watchdog must never tear down another's.
 *
 * LIVENESS (§4.2): a frame that never posts `ready` within the watchdog, or
 * that fails to answer a ping, is unmounted into the frame-level fallback line —
 * never a rewrite of the row's own state (§2.8's precedence). Resize/error
 * messages are COALESCED to at most one of each per animation frame (one rAF
 * flush, latest resize wins, an error latches — R1, the web host's own pair),
 * so a document holding the nonce cannot force a state update per message.
 *
 * THE FRAME'S GROUND is asserted in the mounted bytes
 * (`supplementGroundDocument`): a live theme flip must keep the frame's ground
 * a palette token rather than the platform's opaque default (design round 1,
 * D1).
 *
 * THE HOST -> FRAME PUSH travels as `window.postMessage` inside the document
 * (`hostMessageScript`). That is an ordinary same-document message — the
 * document here is the WebView's TOP-LEVEL document, so `parent === window` and
 * the prelude's `event.source === parent` check holds — and it is what delivers
 * the per-frame nonce in the first theme push. The frame -> host direction is
 * the native shim's (see `nativeSupplementDocument` for why the shared prelude
 * cannot carry it yet).
 */
export type SupplementWebViewProps = {
	component: SupplementComponent;
	/** The assembled document from the relay's read route; `null` until fetched. */
	documentHtml: string | null;
	/** The document could not be fetched (a pruned blob, a refusal, a malformed
	 *  body): the frame paints the frame-level fallback line instead of holding
	 *  its reserved box forever. */
	documentFailed?: boolean;
	/** The row's `supplement_restart` arm, offered as `· Retry` beside the
	 *  fallback line. Absent handler, absent control. */
	onRetry?: () => void;
	/** The frame's current rendered height, on every accepted resize — the
	 *  block's aggregate budget accrues these once a frame is on screen. */
	onHeightChange?: (height: number) => void;
};

export const SupplementWebView = ({
	component,
	documentHtml,
	documentFailed = false,
	onRetry,
	onHeightChange,
}: SupplementWebViewProps) => {
	const resolved = useTheme();
	const theme = useMemo(
		() => supplementThemeFor(resolved.theme),
		[resolved.theme],
	);

	/** The write-time clamped hint: the box's height until the document's own
	 *  first resize arrives, and already inside the same [120, 480] range. */
	const reserved = clampedHeightHint(component);
	const [height, setHeight] = useState(reserved);
	/**
	 * True from mount until the document's first `resize` beat: while true the
	 * reserved box carries the app's shimmer, so the box does not read as a hole
	 * under the answer while the document loads (§2.8 round-1 D4). The shimmer
	 * obeys reduced motion by construction (`Shimmer` parks, and the standing
	 * fill underneath is what a reduced-motion reader keeps).
	 */
	const [awaitingPaint, setAwaitingPaint] = useState(true);
	const [failed, setFailed] = useState(false);

	const webRef = useRef<WebView>(null);
	const nonceRef = useRef("");
	const failedRef = useRef(false);
	const readyRef = useRef(false);
	/** The one-shot guard's latch, and the load counter that belts it (below). */
	const allowedRequestRef = useRef(false);
	const loadCountRef = useRef(0);
	const pingsStartedRef = useRef(false);
	const heightRef = useRef(reserved);
	const themeRef = useRef(theme);
	const onHeightChangeRef = useRef(onHeightChange);
	const bootDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const pongDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** The coalescing pair for resize/error (R1): one rAF flush, latest resize
	 *  wins, an error latches — the web host's semantic mirror. */
	const coalescedRef = useRef<{ resize: number | null; error: boolean }>({
		resize: null,
		error: false,
	});
	const rafRef = useRef<number | null>(null);

	const fail = useCallback(() => {
		if (failedRef.current) return;
		failedRef.current = true;
		setFailed(true);
	}, []);

	/** One host -> frame message, evaluated inside the document. */
	const post = useCallback((message: Record<string, unknown>) => {
		webRef.current?.injectJavaScript(hostMessageScript(message));
	}, []);

	/** One accepted resize's height, applied to the box and reported to the
	 *  block: the same two writes the web host's `applyHeight` makes. */
	const applyHeight = useCallback((next: number) => {
		onHeightChangeRef.current?.(next);
		if (next !== heightRef.current) {
			heightRef.current = next;
			setHeight(next);
		}
	}, []);

	/** At most one resize/error application per animation frame: a hostile
	 *  document holding the nonce can post alternating-height `resize` messages
	 *  at message rate, and uncoalesced each one costs a `setHeight` plus a
	 *  `setMeasured` Map write; the flush takes the LATEST resize and lets an
	 *  error outrank it (R1 — §4.2's control, ported from
	 *  `supplement-webview.web.tsx`'s `scheduleCoalesced`/`applyHeight` pair). */
	const scheduleCoalesced = useCallback(() => {
		if (rafRef.current !== null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			const { resize, error } = coalescedRef.current;
			coalescedRef.current.resize = null;
			coalescedRef.current.error = false;
			if (error) {
				fail();
				return;
			}
			if (resize !== null) applyHeight(resize);
		});
	}, [applyHeight, fail]);

	const pushTheme = useCallback(
		(next: SupplementTheme) => {
			post({
				lo: HOST_MESSAGE_TAG,
				t: "theme",
				mode: next.mode,
				vars: next.vars,
				nonce: nonceRef.current,
			});
		},
		[post],
	);

	/**
	 * One outstanding ping at a time, never coalesced away (§4.2): a `pong`
	 * clears the deadline; a live document that stops answering is unmounted.
	 */
	const sendPing = useCallback(() => {
		if (failedRef.current || pongDeadlineRef.current !== null) return;
		post({ lo: HOST_MESSAGE_TAG, t: "ping" });
		pongDeadlineRef.current = setTimeout(() => {
			pongDeadlineRef.current = null;
			fail();
		}, WATCHDOG_MS);
	}, [fail, post]);

	/**
	 * The ping cadence starts WITH THE THEME PUSH, not at `ready`: a `pong` is
	 * nonce-required, and the nonce only reaches the frame inside the theme
	 * message — so a ping sent at `ready` (which precedes that message) would be
	 * answered by a pong this host must reject, and the deadline would then fail
	 * a live frame five seconds later (the relay's own reading of this order).
	 */
	const startPings = useCallback(() => {
		if (pingsStartedRef.current || failedRef.current) return;
		pingsStartedRef.current = true;
		sendPing();
		pingTimerRef.current = setInterval(sendPing, PING_INTERVAL_MS);
	}, [sendPing]);

	const onLoad = useCallback(() => {
		const count = loadCountRef.current + 1;
		loadCountRef.current = count;
		if (count > 1) {
			/* The second load is a hostile navigation this host let through (or a
			 * navigation the platform reported as a load): either way this is no
			 * longer the document the host mounted. The nonce belt already keeps a
			 * successor's messages out; this unmounts it. Keep the shell silent:
			 * the line is rendered below. */
			fail();
			return;
		}
		pushTheme(themeRef.current);
		startPings();
	}, [fail, pushTheme, startPings]);

	/**
	 * The one-shot navigation guard (memo §4.1's native arm).
	 *
	 * iOS: `loadHTMLString` flows through `decidePolicyForNavigationAction`
	 * BEFORE any script of the document runs, so the FIRST request this handler
	 * sees is the mount load; it is allowed once and every later request is
	 * denied regardless of URL (no `about:blank` allow, no fragment/nonce match —
	 * a component can read `location.href` and re-navigate). Source-verified
	 * against react-native-webview 13.16.1 (`apple/RNCWebViewImpl.m`), replacing
	 * probe P3's empirical half for this platform.
	 *
	 * Android: `loadDataWithBaseURL` never consults `shouldOverrideUrlLoading`
	 * for the mount load, so EVERY request this handler sees is a navigation —
	 * and every one is refused. (The Android half of P3 is still owed a device
	 * probe; if a future platform version starts reporting the mount load here,
	 * this arm fails closed — the frame would paint nothing, which is visible in
	 * QA, rather than a hostile navigation being allowed once.)
	 *
	 * THE ANDROID RESIDUAL, recorded rather than implied (R2): the library
	 * blocks on this JS decision for `SHOULD_OVERRIDE_URL_LOADING_TIMEOUT =
	 * 250` ms and then DEFAULTS TO ALLOW — `RNCWebViewClient.java:42,112-115`
	 * returns `false` and the navigation loads. A JS-thread stall longer than
	 * that window therefore converts a denied navigation into a loaded one; the
	 * second-`load` belt unmounts the frame after the fact, but the request has
	 * already left. Not fixable in this lane — the security round's WebView arm
	 * (S13) carries a burst-under-load row so this residual is probed on a
	 * device rather than assumed away.
	 */
	const onShouldStartLoadWithRequest = useCallback(
		(_request: ShouldStartLoadRequest) => {
			if (allowedRequestRef.current) return false;
			if (Platform.OS === "ios") {
				allowedRequestRef.current = true;
				return true;
			}
			return false;
		},
		[],
	);

	/**
	 * `window.open` / `target="_blank"`: refused on both platforms, by two
	 * different mechanisms, and the handler itself only ever names the attempt.
	 *
	 * - iOS: SETTING this prop is what denies. With it set, the native layer
	 *   cancels a `!hasTargetFrame` navigation and fires this event instead of
	 *   loading it (`apple/RNCWebViewImpl.m` `decidePolicyForNavigationAction`);
	 *   without it the same request loads IN THIS WebView. The handler performs
	 *   no action — cancelling already happened, and opening anything would be
	 *   the popup this refuses.
	 * - Android: `setSupportMultipleWindows={false}` is the control (no second
	 *   window is created); this handler is the belt for the path where a window
	 *   is still offered.
	 */
	const onOpenWindow = useCallback(() => {}, []);

	const onMessage = useCallback(
		(event: WebViewMessageEvent) => {
			let data: unknown;
			try {
				data = JSON.parse(event.nativeEvent.data);
			} catch {
				/* A frame may post anything at all; junk is ignored, never thrown
				 * through a render path. */
				return;
			}
			const message = acceptFrameMessage(data, nonceRef.current);
			if (message === null) return;
			if (message.t === "ready") {
				if (!readyRef.current) {
					readyRef.current = true;
					if (bootDeadlineRef.current !== null) {
						clearTimeout(bootDeadlineRef.current);
						bootDeadlineRef.current = null;
					}
				}
				return;
			}
			if (message.t === "pong") {
				if (pongDeadlineRef.current !== null) {
					clearTimeout(pongDeadlineRef.current);
					pongDeadlineRef.current = null;
				}
				return;
			}
			if (message.t === "resize") {
				setAwaitingPaint(false);
				/* The clamp is the HOST's: the nonce binds the browsing context, not
				 * the code in it, so the range is enforced here too. The value waits
				 * for the flush (R1): the latest resize of an animation frame wins,
				 * and the block hears only the applied height. */
				coalescedRef.current.resize = clampFrameHeight(message.h ?? 0);
				scheduleCoalesced();
				return;
			}
			/* `error`: the document's own report. One quiet line replaces the frame
			 * (§2.8); the row's committed state is never rewritten by it. It rides
			 * the same flush, where it outranks a pending resize. */
			coalescedRef.current.error = true;
			scheduleCoalesced();
		},
		[scheduleCoalesced],
	);

	/*
	 * Arm the nonce and the boot deadline when the document arrives, and drop
	 * every timer on unmount. The deadline is the watchdog's first half: a frame
	 * that never posts `ready` is not a live document (§4.1/§4.2).
	 */
	useEffect(() => {
		if (documentHtml === null) return;
		nonceRef.current = mintNonce();
		if (!readyRef.current && !failedRef.current) {
			bootDeadlineRef.current = setTimeout(() => {
				if (!readyRef.current) fail();
			}, WATCHDOG_MS);
		}
		return () => {
			if (bootDeadlineRef.current !== null) {
				clearTimeout(bootDeadlineRef.current);
				bootDeadlineRef.current = null;
			}
		};
	}, [documentHtml, fail]);

	/* One cleanup for the cadence's own timers and the coalescing flush, owned
	 * by the component's life. */
	useEffect(
		() => () => {
			if (pingTimerRef.current !== null) clearInterval(pingTimerRef.current);
			if (pongDeadlineRef.current !== null)
				clearTimeout(pongDeadlineRef.current);
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
		},
		[],
	);

	/*
	 * The theme channel: the FIRST push rides the frame's first `load` (the
	 * prelude installs its listener synchronously and stays hidden until a theme
	 * arrives); every later change is one more push, never a reload — the live
	 * re-ink requirement. Only after a load, because the push is what delivers
	 * the nonce.
	 */
	themeRef.current = theme;
	useEffect(() => {
		if (loadCountRef.current > 0 && !failedRef.current) pushTheme(theme);
	}, [theme, pushTheme]);

	/* Two injections ride the fetched bytes before the frame mounts — the native
	 * shim (`nativeSupplementDocument`) and the ground rule
	 * (`supplementGroundDocument`, whose docstring carries why — D1); the served
	 * document is otherwise mounted byte-for-byte. */
	const source = useMemo(
		() =>
			documentHtml === null
				? null
				: {
						html: nativeSupplementDocument(
							supplementGroundDocument(documentHtml),
						),
						baseUrl: "about:blank",
					},
		[documentHtml],
	);

	if (failed || documentFailed) {
		/* The frame-level fallback line (§2.8): one quiet line where the graphic
		 * was, never a rewrite of the row's own state. `· Retry` is the row's own
		 * `supplement_restart` arm and exists only when the block wired one. */
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
				{source !== null ? (
					<WebView
						ref={webRef}
						source={source}
						originWhitelist={["*"]}
						javaScriptEnabled
						incognito
						sharedCookiesEnabled={false}
						thirdPartyCookiesEnabled={false}
						allowFileAccess={false}
						allowUniversalAccessFromFileURLs={false}
						setSupportMultipleWindows={false}
						onMessage={onMessage}
						onLoad={onLoad}
						onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
						onOpenWindow={onOpenWindow}
						/* Transparent, so the frame re-inks with the page's theme and
						 * never paints the platform's default white over a dark canvas. */
						style={{ flex: 1, backgroundColor: "transparent" }}
						containerStyle={{ backgroundColor: "transparent" }}
					/>
				) : null}
				{awaitingPaint && source !== null ? (
					<Shimmer active className="absolute inset-0">
						<View className="h-full w-full bg-elevated" />
					</Shimmer>
				) : null}
			</View>
			{/* The one caption the host renders: exactly one `Source: …` line per
			 * component (§2.10). The document prints none. */}
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
