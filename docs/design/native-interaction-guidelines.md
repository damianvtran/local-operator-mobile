# Native conversation design and interaction rules

These rules complement the [brand kit](brand-kit.md), [components](components.md)
and [styling layer](styling-layer.md). They do not replace the token source or
create a second theme. Keep iOS and Android platform behaviour: the relay is a
reference for hierarchy and state honesty, not a web layout to transplant.

## Identity and chrome

The conversation/navigation identity is the existing white circular disk with
its black Local Operator figure: `assets/brand/navigation-mark.png`, copied
byte-for-byte from `local-operator-ui/resources/icon-small.png` on 2026-10-26.
SHA256: `e438b0430a45a6b42c4e1a49ac8b52c5e5fdefe0955251d94abfbcc0217f7113`.
It is 128×128, sufficient for a 32pt mark at 3×. Do not substitute the inverse
large desktop icon, recolour it, or redraw the motif. This is a deliberately
narrow exception to the kit's unfilled-mark rule: 28pt in conversation chrome,
32pt in the drawer, decorative beside a named destination. Bare `BrandMark`
remains appropriate elsewhere. Never duplicate an adjacent accessible name.

Keep the menu at the far left, before badges; menu/search glyphs are 24pt.
Glyph size and touch area are separate: actual pressables remain at least 44pt
on iOS and 48dp on Android, including at large text sizes. Preserve labels,
keyboard focus indication and selected-state contrast.

Use the existing ground ladder—canvas, surface, sunken and elevated—and spacing
rather than a rule around every ordinary row. Keep semantic warning/danger and
approval boundaries, focus indicators, selection, code/table edges, and modal
contrast. A border removal is a local design decision, never a global search
and replace. The selected conversation must remain obvious without colour alone.

## Composer and secondary information

The composer is one tonal surface: a full-width growing field, then a toolbar
with attachment/voice, model/effort/folder disclosures and stable trailing
send/stop controls. Its visible field label can disappear; its accessible name
cannot. Six-line growth remains bounded; metadata wraps or moves into an
explicit sheet at large text. Preserve the existing compact/keyboard budget,
safe-area padding and multiline/IME behaviour. Do not hard-code a relay height.

Keep the same mounted TextInput, caret, selection and attachments as startup
acquires its server ID, configuration loads, or a command is acknowledged.
Typing and sending are different operations. Never clear a newer draft because
an older queued message succeeded. Keep Stop independent from Send while both
are available. Recording, transcription, retries and permission failures retain
their specific messages and accessible controls.

Context, costs, tasks and agents may sit behind a calm, labelled disclosure,
but counts and destinations stay reachable. Urgent asks/approvals keep their
arrival-open policy and cannot disappear behind an unlabelled overflow menu.
Tool-turn condensing is a separate contract and must not change incidentally.
Sheets reuse the native modal/back/focus machinery, not nested web navigation.

Scroll-edge fades, when used, must be native, noninteractive overlays, present
only while content continues in that direction. They cannot intercept gestures,
cover endpoint text or controls, defeat virtualization, or imply missing content
when the scroller is already at its end.

## Draft, queue, admission and privacy

New opens a local editable conversation immediately. Only an explicit Send
creates backend work. An editable unsent draft and a submitted pending FIFO are
separate: label pending items as queued/starting, never as sent. Persist exact
text, attachment bytes, selections and immutable command IDs before dispatch.
Storage failure means retain the live draft, show the failure and do not send;
an in-memory fallback cannot be described as restart-safe.

After ambiguous creation on a relay without advertised creation idempotency,
stop. Do not retry creation, infer an ID from the latest session, or silently
switch account/model/folder. Queued items keep their identity across retry.
One acknowledged item cannot overtake or erase another, including equal text.

A route/account/auth-generation boundary withdraws dispatch before replacing
state. Explicit sign-out and authentication failure retain privacy precedence;
do not promise cross-login recovery without independently proven ownership and
appropriate protected storage. Offline/restart recovery within a valid scope
is not a promise of retention through sign-out or account change.

## Evidence before release

Review actual before/after frames in light and dark, default and large text,
phone widths including 320/360/390/430 and tablet split layouts. Cover empty,
loading, populated, error, search, sheets, multiline, attachments and voice;
compare first/settled frames and measured geometry. Verify every drawer
function remains reachable, including capability-gated ones.

A fixed-size iframe of the actual web export is useful layout evidence, not
native keyboard, Dynamic Type, safe-area or device-pixel-ratio proof. Record
actual dimensions/theme/insets, not merely requested fixture values. Native
CI/device flows must cover native claims; a source assertion or green unit test
cannot stand in for a rendered review or a real delayed/failing relay request.
