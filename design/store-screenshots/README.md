# Store screenshots

Frame templates for the listing screenshots, sized to what each store accepts
today. **These are templates, not screenshots**: each one draws the canvas at the
exact required size and reserves the app's screen area inside it, so the
implementation phase drops a real app capture into the marked slot and gets a
correctly-sized asset with no resampling.

| Template | Canvas | Slot | Where it is required |
|---|---|---|---|
| `iphone-6.9.html` | 1320 × 2868 | 1000 × 2172 | App Store Connect, 6.9-inch iPhone class |
| `ipad-13.html` | 2064 × 2752 | 1400 × 1867 | App Store Connect, 13-inch iPad class — **only if the app runs on iPad** |
| `play-phone.html` | 1080 × 1920 | 1080 × 1700 | Google Play, phone |

Render them with `node design/preview/capture.mjs --target frames`, which writes
`out/<name>.png` (gitignored) and **asserts the output size matches the file
name's spec** — an off-by-one canvas is rejected by the store, so the script
fails rather than shipping a frame nobody measured.

## App Store Connect

Source: <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>
(read 2026-09-29).

- **6.9-inch iPhone class** accepts 1260 × 2736, 1290 × 2796 and 1320 × 2868
  (portrait) or their landscape transposes. This template uses the largest.
  Required if the app runs on iPhone and no other class supplies screenshots.
- **13-inch iPad class** accepts 2064 × 2752 or 2048 × 2732. Required if the app
  runs on iPad.
- One to ten screenshots per size, at least one required.
- Screenshots must be PNG or JPEG and must **not** be transparent.
- The image itself is validated, so a caption band stacked on top of a native-size
  capture is rejected — which is why every template insets the app inside the
  canvas instead.
- Screenshots are directionally cropped on some surfaces, so the composition must
  survive a narrower crop.

## Google Play

Source: <https://support.google.com/googleplay/android-developer/answer/9866151>
(read 2026-09-29).

- **Required to publish:** at least **two** screenshots across different device
  types, JPEG or 24-bit PNG, **no alpha**, each side between **320 and 3840 px**,
  and no side more than twice the other's length. `play-phone.html`'s 1080 × 1920
  satisfies all of these.
- **Recommended** (and required to be eligible for the large promotional
  formats): at least **four** screenshots at a minimum of 1080 px on the short
  side, 9:16 portrait.
- Content rules that bind the composition: show the real app experience; keep any
  tagline under **20% of the image** (the frame's caption band is 220 / 1920 =
  11.5%); no ranking, award, testimonial or price claims; no call to action
  ("Install now"); do not show fingers on a device.
- **Also required to publish:** a feature graphic at 1024 × 500, JPEG or 24-bit
  PNG with no alpha — `design/app-icon/store/play-feature-graphic.html`, rendered
  by the same capture script — and an app icon at 512 × 512 as a 32-bit PNG with
  alpha, up to 1 MB (`design/app-icon/store/play-icon-512.png`).
- Do not bake rounded corners or drop shadows into the Play icon: Play renders
  both.

## How a real capture gets in

1. Capture the app at 3x on a 6.9-inch device (or a 390 × 844 viewport at dpr 3,
   which is the same pixels) for iPhone.
2. In the template, replace the `.slot` element with
   `<img src="…" width="1000" height="2172">` and remove the `empty` class.
3. Run the capture script, which re-asserts the output size, and view the result
   before uploading it.

The slot's aspect matches its canvas exactly in the two App Store templates, so
the capture scales to fit with no letterboxing. The Play template's slot is
deliberately taller relative to its width (0.635 against a phone's 0.46): at a
1920-tall canvas there is no room for a caption band at the phone's own aspect, so
feed it a capture cropped to the slot's aspect rather than one scaled down with
bars.
