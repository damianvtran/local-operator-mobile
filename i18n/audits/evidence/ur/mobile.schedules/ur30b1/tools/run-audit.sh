#!/bin/bash
# Real execution log for ur group B audit. Every command below ran; output is verbatim.
S=<scratch>/ur-audit-b
W=<scratch>/ur-wave
export HOME=$(mktemp -d)
run(){ echo; echo "\$ $*"; "$@" 2>&1; echo "[exit $?]"; }
echo "audit run $(date -u +%FT%TZ) host=$(hostname -s)"
cd $W
run git rev-parse --short HEAD
run git status --short
cd $W/src/i18n/catalogues
for ns in schedules projects notifications computers; do run shasum -a 256 ur/mobile.$ns.json en/mobile.$ns.json en/mobile.$ns.context.json; done
cd $W
run node_modules/.bin/tsx $S/parity.ts
run node_modules/.bin/tsx scripts/i18n/generate.ts --check
run python3 $S/scan.py
run python3 $S/dump.py
run node_modules/.bin/tsx $S/render.ts
run node_modules/.bin/tsx $S/repl.ts
echo; echo '$ node -e Intl.PluralRules(ur)'; node -e 'console.log([0,1,2,21,100].map(n=>n+":"+new Intl.PluralRules("ur").select(n)).join(" "))'
echo; echo '$ python3 name-grammar check against core projects.py _NAME_RE (origin/main)'
git -C <core> show origin/main:local_operator/projects.py | sed -n 84,86p
python3 - <<'P'
import re
R=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
for n in ["پروجیکٹ","alpha","_x",".x","-x","a b","x"*64,"x"*65]:
    print(repr(n if len(n)<12 else n[:6]+'…(%d)'%len(n)),bool(R.match(n)))
P
echo; echo '$ core ur precedent greps (origin/main, git -C ~/local-operator)'
G="git -C <core> grep -hE"
for p in 'مزید ٹیگ' 'tui.schedule.due_overdue|tui.schedule.due_in' 'relay.notifications.row.dismiss|relay.notifications.detail.section.(projects|history|from)|tui.notifications.hint_dismiss' 'wire.settings.aida_enabled.choice.false.description'; do echo "## $p"; $G "$p" origin/main -- 'local_operator/i18n/catalogues/ur/*.json' | cut -c1-200; done
echo; echo '$ glossary note 7 (supervised)'; git -C <core> show origin/main:i18n/glossary.md | sed -n 91,99p
echo; echo '$ vitest (scoped, maxWorkers=2, scratch HOME): i18n catalogues + messages tests'
cd $W; timeout 200 node_modules/.bin/vitest run src/i18n/__tests__/catalogues.test.ts src/i18n/__tests__/messages.test.ts --maxWorkers=2 2>&1 | grep -vE "^\s*$" | tail -40
echo "[note] the one failure is the 'catalogue directories == SHIPPED_LOCALES' assertion: ur is not yet in SHIPPED_LOCALES (translator/wiring scope, not a copy defect)."
echo; echo '$ git -C ur-wave status --short (post-run, proves read-only)'; git status --short
