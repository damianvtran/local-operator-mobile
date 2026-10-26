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
