#!/usr/bin/env bash
# M2 fr DELTA audit — execution log. Read-only: every write lands in $OUT.
set -u
WT="$HOME/local-operator-mobile/.worktrees/i18n-m2-scanner"
OUT="$(cd "$(dirname "$0")" && pwd)/audit.log"
OLD=3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a
NEW=c4024b497a4db3118aae70d8bb132301ea3ab097

: > "$OUT"
say() { printf '\n$ %s\n' "$*" >> "$OUT"; }

{
  echo "M2 fr DELTA audit — PR #236 round 2 — $(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC"
  echo "scope: ${OLD:0:8}..${NEW:0:8}   worktree: $WT"
  echo "auditor: i18n-auditor, session 413dca6f8baa, model deepseek/deepseek-flash (session header)"
} >> "$OUT"

say "git -C \$WT rev-parse HEAD"
git -C "$WT" rev-parse HEAD >> "$OUT" 2>&1
say "git -C \$WT status --porcelain   # must be empty: read-only lane"
git -C "$WT" status --porcelain >> "$OUT" 2>&1
say "git -C \$WT log --oneline -3"
git -C "$WT" log --oneline -3 >> "$OUT" 2>&1

say "git -C \$WT diff --name-only $OLD..$NEW"
git -C "$WT" diff --name-only "$OLD..$NEW" >> "$OUT" 2>&1
say "git -C \$WT diff $OLD..$NEW -- src/i18n/catalogues/fr/"
git -C "$WT" diff "$OLD..$NEW" -- src/i18n/catalogues/fr/ >> "$OUT" 2>&1
say "git -C \$WT diff $OLD..$NEW -- src/i18n/catalogues/en/mobile.session.context.json"
git -C "$WT" diff "$OLD..$NEW" -- src/i18n/catalogues/en/mobile.session.context.json >> "$OUT" 2>&1

say "cross-locale stream_degraded + stream_offline values at $NEW (case/multi-word precedent)"
python3 - "$WT" <<'PY' >> "$OUT" 2>&1
import json, sys
wt = sys.argv[1]
for loc in ("en", "fr", "es", "ru", "vi", "ur", "hi", "zh-CN"):
    d = json.load(open(f"{wt}/src/i18n/catalogues/{loc}/mobile.settings.json"))
    row = []
    for k in ("stream_idle", "stream_connecting", "stream_live", "stream_degraded", "stream_offline"):
        row.append(f"{k.split('_',1)[1]}={d['mobile.settings.diagnostics.'+k]!r}")
    print(f"  {loc:6s} " + "  ".join(row))
PY

say "narrow-slot selection at HEAD: the code path that picks the short form"
grep -n "viewportWidth < 340" "$WT/app/(app)/session/[id].tsx" >> "$OUT" 2>&1
grep -n "mobile.session.tray.context" "$WT/app/(app)/session/[id].tsx" >> "$OUT" 2>&1
sed -n '1008,1013p;1690,1698p' "$WT/app/(app)/session/[id].tsx" >> "$OUT" 2>&1

say "node scripts/i18n/generate.ts --check"
( cd "$WT" && node scripts/i18n/generate.ts --check ) >> "$OUT" 2>&1
echo "exit=$?" >> "$OUT"

say "node scripts/i18n/check-strings.ts"
( cd "$WT" && node scripts/i18n/check-strings.ts ) >> "$OUT" 2>&1
echo "exit=$?" >> "$OUT"

say "python3 checks.py   # this session's own checks (inventory, delta, hashes, mechanics, negative control)"
python3 "$(dirname "$0")/checks.py" >> "$OUT" 2>&1
echo "exit=$?" >> "$OUT"

say "end of scripted run — hashes of inputs re-read at the end (tree unchanged?)"
git -C "$WT" status --porcelain >> "$OUT" 2>&1
echo "(empty above = worktree untouched by this audit)" >> "$OUT"
echo "log written: $OUT"
