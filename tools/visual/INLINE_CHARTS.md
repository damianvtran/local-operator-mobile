# Inline charts: visual and relay checks

The Expo component fixture mounts `InlineUiPreview` itself with the production
stylesheet, theme and text-scale providers, but no router or login. No new
packages or native toolchain are needed. From the repository root with the
lockfile's dependencies available:

```sh
OUT="$LOCAL_OPERATOR_SCRATCHPAD/inline-chart-web"
EXPO_OFFLINE=1 pnpm export:web --no-minify --max-workers 2 --output-dir "$OUT"
EXPO_OFFLINE=1 pnpm exec expo export:embed --platform web \
  --entry-file tools/visual/inline-charts-entry.tsx --dev false --minify false \
  --max-workers 2 --bundle-output "$OUT/chart-component.js"
node --input-type=module - "$OUT" <<'JS'
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serveDir } from "./tools/lib/static-server.ts";
const out = process.argv[2];
const stylesheet = readdirSync(join(out, "_expo/static/css")).find(
  (name) => name.startsWith("theme-") && name.endsWith(".css"),
);
if (!stylesheet) throw new Error("Expo did not export the theme stylesheet");
writeFileSync(join(out, "chart-component.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inline charts | Expo component fixture</title>
<link rel="stylesheet" href="/_expo/static/css/${stylesheet}">
<style>html,body,#root{height:100%;margin:0}#root{display:flex}</style>
<div id="root"></div><script defer src="/chart-component.js"></script></html>`);
const server = await serveDir(out);
console.log(`${server.url}/chart-component.html?width=390&theme=light`);
JS
```

Open the printed URL in the harness browser; try `width=320&theme=dark` and
`width=430&theme=light`. Omit `case` for the complete chart transcript, or set
it to one of `bar`, `histogram`, `line`, `pie`, `scatter`, `heatmap`, `grouped`,
`stacked`, `percent`, `dual`. Open and close **Chart data** with both pointer
and keyboard. Compare the signs, zeros, units and unrounded values in the grid
(e.g. `1.765 °C` in line, `800 requests` vs `6 ms` in dual). This is Expo web
component evidence, not native device, accessibility-service or full-app proof.

The same data rides the real mock-relay wire with
`pnpm mock:relay --scenario inline-charts --print-port`. Use the same-origin
proxy from [the web audit instructions](../../docs/e2e/README.md) for a full-app
walkthrough: open **Inline chart examples** (session `6714def86197`) and scroll
to the oldest row to see the literal `lop-ui` fence remain code. Only history
and SSE requests with `inline_ui=1` get matching chart sidecars; the unnegotiated
history returns the legacy text. Stop both loopback processes after review.
