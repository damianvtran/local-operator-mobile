# Team Bridge profile photos and cards — browser evidence

Every image uses placeholder identities, a synthetic flat-colour PNG generated
by `tools/mock-team-bridge.ts` and a synthetic-token loopback hub. No real
account is involved. These frames come from the **actual Expo/React Native web
export** in a real 390×844 iframe viewport. The wrapper scales them for display.
They are not native screenshots: native builds run in CI.

Fixture rows: Ada has a photo, a title, a description, a London timezone and
`pronouns` sent by the hub. Ben advertises a photo that the hub answers 404,
and an invalid timezone.

Captured from `70d03114` (the PR's first head):

- [List, light](list-light.png): Ada's photo is shown. Ben's 404 and everyone
  without a photo keep their initials.
- [Agent card, light](card-agent-light.png): "Nova (Ada)", the Agent badge,
  "Ada’s chief of staff", the owner's details and local time.
- [Message from the agent card](agent-draft-from-card-light.png): this opens
  the existing draft path. The hub's `created` counter stayed at 0.

Captured one commit earlier, on the same code path. The later change only
affects agent initials, and these are person surfaces:

- [Person card, light](card-person-light.png) and
  [dark](card-person-dark.png): the 256 px photo, the Person badge, title,
  description and "Local time". No pronouns appear.
- [List, dark](list-dark.png).

Hub request counts on a fresh origin (`/__stats`, no bearer recorded): one
64 px read for each person with an `avatar_url`, one 256 px read for each
card opened, and **no repeat of Ben's 404** across list → card → thread →
card.

## Round 1 remediation

Same rig (web export, loopback mock in `MOCK_TEAM_BRIDGE_STRICT=1`, 360 and
430 pt iframes). A long-name person, "Maximiliana
Konstantinopoulou-Whitfield-Abernathy", and her long-named agent "Wilhelmina
the Extraordinarily Thorough" are now committed fixture rows. Geometry was read
from the live DOM.

- **D1, the full name wraps beside the photo.** The heading is 198×78 at 360
  (3 lines) and 268×78 at 430. The agent's is 198×156 at 360 and 268×104 at
  430. In every case `white-space: pre-wrap` and `scrollWidth == clientWidth`,
  so nothing clips. The order is name, title, badge; the owner's details sit
  under "About {owner}" on agent cards. The sheet title reads "Profile".
  Frames: `r1-remediation-card-long-*`, `r1-remediation-card-longagent-*`,
  light and dark at 360 and 430.
- **D2, rows are back to 68 pt.** Every one-line row at 360 measures 68:
  Channels, Groups, People (Sam, Ada, Ben, Cy) and Chiefs of staff. Before the
  fix Ada and Ben were 56 and the rest 64.8. Rows grow only when a long label
  wraps. Frames: `r1-remediation-list-{light,dark}-360`.
- **D3, one 44 pt focus stop per message header.** The author name is the
  control: Ada 28.9×44, Sam 32×44, "Aida (Ben)" 76.3×44. Each header has
  exactly one focusable element (it was two: the photo had `tabindex=0`). The
  photo still opens the card on touch. Frames:
  `r1-remediation-thread-{light,dark}-360`.
