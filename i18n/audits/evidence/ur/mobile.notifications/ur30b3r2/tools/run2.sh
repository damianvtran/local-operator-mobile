#!/bin/bash
S=<scratch>/ur-audit-b2
W=<scratch>/ur-wave
export HOME=$(mktemp -d)
run(){ echo; echo "\$ $*"; "$@" 2>&1; echo "[exit $?]"; }
echo "audit run $(date -u +%FT%TZ) host=$(hostname -s) HOME=scratch-mktemp"
cd $W
run git rev-parse --short HEAD
run git status --short
cd $W/src/i18n/catalogues
for ns in schedules projects notifications computers; do run shasum -a 256 ur/mobile.$ns.json en/mobile.$ns.json en/mobile.$ns.context.json; done
cd $W
run python3 $S/revert.py
run node_modules/.bin/tsx $S/render2.ts
echo; echo '$ python3 bidi/redaction scan (all 12 inputs)'; python3 $S/scan.py
echo; echo '$ Intl.PluralRules(ur)'; node -e 'console.log([0,1,2,21,100].map(n=>n+":"+new Intl.PluralRules("ur").select(n)).join(" "))'
echo; echo '$ relay regex source (origin/main core)'; git -C <core> show origin/main:local_operator/projects.py | grep -n "_NAME_RE" | head -3
run node_modules/.bin/tsx scripts/i18n/generate.ts --check
run node scripts/i18n/check-strings.ts
echo; echo '$ vitest scoped'; timeout 250 node_modules/.bin/vitest run src/i18n/__tests__/catalogues.test.ts src/i18n/__tests__/messages.test.ts --maxWorkers=2 2>&1 | grep -vE "^\s*$" | tail -30
echo; echo '$ git status post-run'; git status --short
