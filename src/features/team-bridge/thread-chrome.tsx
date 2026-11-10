import { Paperclip } from "lucide-react-native";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import {
	ATTACH_GLYPH_PT,
	COMPOSER_DISC,
} from "@/features/session/composer-layout";
import {
	COMPOSER_BASE_HEIGHT,
	COMPOSER_SIDE_PAD,
	composerRestRow,
	composerShellPadding,
	morphPillRadius,
} from "@/features/session/composer-presentation";
import { sessionHeaderTitle } from "@/features/session/header";
import { CONTROL, ROLE, SURFACE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Heading } from "@/ui/components/heading";
import { Textarea } from "@/ui/components/textarea";
import { TOUCH_FLOOR, useCompactChrome } from "@/ui/layout";
import { headerStacks } from "@/ui/size-class";
import { useTextScale } from "@/ui/text-scale-provider";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";

/**
 * The Team Bridge thread's header title and composer field, drawn with the
 * agent chat session's own primitives.
 *
 * WHY THIS FILE EXISTS. The operator, on TestFlight 753: "the team bridge titles
 * are still way too large" and "should probably be closer in size to the chat
 * conversation titles which seem to be better sized". The thread drew its own
 * header title (28 pt `display`, then 20 pt `text-title` over two lines after
 * PR #208) and its own composer (a visible "Message" label above a bordered
 * field, then two full-width "Add image" / "Send" buttons), so the two
 * conversation screens of one app looked like two apps. Both now read the
 * session's source of truth instead of restating it:
 *
 *  - the title's class and line clamp are `sessionHeaderTitle`, the function
 *    `SessionHealthControl` itself draws with, so a future ramp move lands on
 *    both headers at once;
 *  - the composer's disc, glyph size, pill radius and resting row are the
 *    agent composer's exported layout tokens (`composer-layout.ts`,
 *    `composer-presentation.ts`).
 *
 * WHAT IS DELIBERATELY NOT SHARED. The agent composer's component
 * (`features/session/components/composer.tsx`) is not reused: it is a morphing,
 * keyboard-docked shell bound to the session runtime (steer/stop, dictation,
 * model strip), and none of that applies to a bridge message. Only its tokens
 * and its send-disc treatment are reproduced here, and this component owns no
 * bridge behaviour — the screen still owns the draft, the attachment
 * controller, the send fence and the retry wording, and passes them in.
 */

/**
 * The thread's level-1 heading, in the session header's title style.
 *
 * The facts are the ones the session screen derives: `compact` is the
 * short-landscape chrome (`useCompactChrome`), and `stacked` is `Screen`'s own
 * stacking rule (`headerStacks` with no screen-specific bound — the bridge
 * passes none), so the clamp is TWO lines exactly when `Screen` has given the
 * title its own row (large text / narrow phone) and ONE line beside the back
 * control otherwise. The tail is cut by layout, never by a character count.
 */
export function BridgeThreadTitle({ title }: { title: string }) {
	const compact = useCompactChrome();
	const { effectiveScale } = useTextScale();
	const { width } = useWindowDimensions();
	const stacked = !compact && headerStacks(effectiveScale, width);
	return (
		<BridgeThreadTitleView title={title} compact={compact} stacked={stacked} />
	);
}

/** The drawing half of `BridgeThreadTitle`, hook-free so the Node suite can
 *  assert each layout branch without a native layout host. */
export function BridgeThreadTitleView({
	title,
	compact,
	stacked,
}: {
	title: string;
	compact: boolean;
	stacked: boolean;
}) {
	const style = sessionHeaderTitle({ compact, stacked });
	return (
		/* The SAME slot the session title takes (`min-w-0 flex-1` around the
		 *  heading, `SessionHealthControl`'s no-reading branch), so the trailing
		 *  notifications control is pushed to the edge and the name, not the
		 *  control, is what gives way. */
		<View className="min-w-0 flex-1">
			<Heading
				level={1}
				className={style.className}
				/* React Native's default `ellipsizeMode` is "tail", which is the
				 *  session title's cut; `Heading` does not forward the prop. */
				numberOfLines={style.numberOfLines}
			>
				{title}
			</Heading>
		</View>
	);
}

/** Where the field's text starts, measured from the shell's outer edge (inside
 *  its 1 pt border): side padding plus the attach column. The agent composer's
 *  resting row is the same sum with the same values, so the two placeholders
 *  line up; the suite asserts it against the rendered shell. */
export const BRIDGE_TEXT_INSET = COMPOSER_SIDE_PAD + TOUCH_FLOOR;

export type BridgeComposerFieldProps = {
	/** The field's accessible name ("Message"): kept as the name, not painted —
	 *  the placeholder ("Message qa-coordination") already says what it is. */
	label: string;
	placeholder: string;
	draft: string;
	onDraftChange: (value: string) => void;
	/** A send is in flight: the field and both controls hold still. */
	sending: boolean;
	/** The accessible name of the add-image control ("Add image"). Absent when
	 *  this thread has no attachment controller, so no attach control renders. */
	attachLabel?: string;
	attachDisabled?: boolean;
	onAttach?: () => void;
	/** "Send", or "Retry send" when pressing it can succeed after a failure. */
	sendLabel: string;
	sendDisabled: boolean;
	onSend: () => void;
};

/**
 * ONE rounded field with an inline attach disc before it and the send disc
 * after it — the agent composer's resting look.
 *
 * Every visible word the old controls carried survives as the control's
 * accessible name (`Add image`, `Send` / `Retry send`), the names the attach
 * sheet, the e2e flows and VoiceOver users already rely on; the glyphs are
 * `aria-hidden`. The testIDs are unchanged (`CONTROL.teamBridgeAttach`,
 * `CONTROL.teamBridgeSend`, `CONTROL.teamBridgeMessageInput`).
 *
 * KEYBOARD. The field keeps the bridge's existing behaviour: Return is a
 * newline and sending is the disc. The agent composer's web Enter-to-send is a
 * session behaviour and is NOT adopted here (non-goal of this change).
 */
export function BridgeComposerField({
	label,
	placeholder,
	draft,
	onDraftChange,
	sending,
	attachLabel,
	attachDisabled = false,
	onAttach,
	sendLabel,
	sendDisabled,
	onSend,
}: BridgeComposerFieldProps) {
	const elevated = useTokenColor("elevated");
	const borderControl = useTokenColor("border-control");
	const attachInk = useTokenColor("ink-muted");
	const disabledInk = useTokenColor("ink-disabled");
	const sendOff = sendDisabled || sending;
	const attachOff = attachDisabled || sending;
	const pad = composerShellPadding(false);
	const row = composerRestRow(TOUCH_FLOOR);
	return (
		<View
			/* The shell: the agent composer's `elevated` pill at rest — the 56 pt
			 *  pill's radius (`morphPillRadius(COMPOSER_BASE_HEIGHT)`), its 4 pt
			 *  vertical padding and 12 pt sides. Its 1 pt `border-control` edge is the
			 *  shell's only boundary, as in the agent composer: `elevated` over
			 *  `canvas` is under the 3:1 a boundary owes. It is NOT animated: a bridge field
			 *  grows with its draft (the Textarea's own line growth, capped at six),
			 *  and the controls stay on the BOTTOM row so a long draft never moves
			 *  Send away from the thumb.
			 *
			 *  NO `gap` between the three columns (operator, TestFlight 773: "the
			 *  placeholder is off alignment"). The agent composer's resting row is
			 *  attach · field · send with nothing between them, so its text starts
			 *  12 + 44 = 56 pt in from the shell edge; the 4 pt gap this shell used
			 *  to add put the bridge's text at 60. `BRIDGE_TEXT_INSET` is that sum,
			 *  pinned by the suite against the agent composer's own values. */
			className="flex-row items-end"
			style={{
				backgroundColor: elevated,
				borderWidth: 1,
				borderColor: borderControl,
				borderRadius: morphPillRadius(COMPOSER_BASE_HEIGHT),
				paddingTop: pad.top,
				paddingBottom: pad.bottom,
				paddingHorizontal: COMPOSER_SIDE_PAD,
				minHeight: COMPOSER_BASE_HEIGHT,
			}}
			testID={SURFACE.teamBridgeComposerShell}
		>
			{onAttach && attachLabel ? (
				<Pressable
					/* Each control box is the RESTING ROW's height (48, H5), not the
					 *  44 pt floor, with its disc centred: the agent composer centres a
					 *  44 pt disc in its 48 pt row (`composerFieldRowAlign(false)`), and
					 *  this row stays `items-end` so a growing draft keeps the discs on
					 *  its last line — boxes of the row's own height give both at once
					 *  (TestFlight 773: the paperclip and Send sat in the bottom
					 *  corners of a tall card, level with nothing). */
					style={{ minWidth: TOUCH_FLOOR, minHeight: row }}
					className="items-center justify-center"
					accessibilityRole={ROLE.button}
					accessibilityLabel={attachLabel}
					accessibilityState={state({ disabled: attachOff })}
					disabled={attachOff}
					onPress={onAttach}
					testID={CONTROL.teamBridgeAttach}
				>
					<View className={COMPOSER_DISC}>
						<Paperclip
							size={ATTACH_GLYPH_PT}
							color={attachOff ? disabledInk : attachInk}
							aria-hidden
						/>
					</View>
				</Pressable>
			) : null}
			<View
				className="min-w-0 flex-1 justify-center"
				style={{ minHeight: row }}
			>
				<Textarea
					label={label}
					hideLabel
					integrated
					/* ONE line of placeholder, the agent composer's own rule (§2.5 D1):
					 *  the resting height must never grow with a wrapped placeholder.
					 *  #213 left it uncapped because the placeholder was "Message
					 *  {channel}", and an `integrated` field stays a <textarea> on web,
					 *  which wraps a long name and cannot ellipsize it — capped, the
					 *  tail was CUT; uncapped, a long name wrapped and on iOS the empty
					 *  field rested as a tall card (TestFlight 773, ~85 pt). The screen
					 *  now passes the short channel-free "Message" instead: the thread
					 *  title right above already names the channel, so the name in the
					 *  field said nothing new and was the only thing that could wrap. */
					placeholderMaxLines={1}
					placeholder={placeholder}
					value={draft}
					onChangeText={onDraftChange}
					disabled={sending}
					testID={CONTROL.teamBridgeMessageInput}
				/>
			</View>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={sendLabel}
				accessibilityState={state({ disabled: sendOff, busy: sending })}
				style={{ minWidth: TOUCH_FLOOR, minHeight: row }}
				className="items-center justify-center"
				disabled={sendOff}
				onPress={onSend}
				testID={CONTROL.teamBridgeSend}
			>
				{/* The agent composer's send disc: `accent` when it can send, `sunken`
				 *  with the kit's disabled-label ink otherwise, an "↑" glyph and "…"
				 *  while a send is in flight. */}
				<View
					className={cx(COMPOSER_DISC, sendOff ? "bg-sunken" : "bg-accent")}
				>
					<Text
						aria-hidden
						className={cx(
							"text-body-sm font-medium",
							sendOff ? CONTROL_DISABLED_INK : "text-on-accent",
						)}
					>
						{sending ? "…" : "↑"}
					</Text>
				</View>
			</Pressable>
		</View>
	);
}
