# Home work list: rendered evidence (head after review round 1)

Web captures of the real app (`expo export --platform web`, `tools/visual/capture.ts`, headless Chrome, mock relay scenarios pinned with `--scenario`; route `/`).

- `many-light100-135-200-dark100.png`: scenario `many` (one waiting, two running, one recent). Light at 100 %, 135 %, 200 % (titles wrap to two lines, folder line dropped on running rows at 200 %, a 16 pt floor under the greeting), dark at 100 %.
- `idle-empty-refused-iphonese200.png`: `idle` (recent only), `empty` (brand-new: two Try rows), `billing-inactive` (the mock's refusal renders the generic "couldn't connect" recovery panel: no list behind it; the real phone-access-off panel is pinned by a unit test, the mock cannot render it), iPhone SE at 200 % (band scrolls).

No native simulator frame: see the PR description.
