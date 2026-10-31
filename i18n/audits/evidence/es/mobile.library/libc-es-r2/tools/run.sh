#!/bin/bash
# usage: run.sh <locale> <round1-id> ; stdout is the audit.log of the r2 delta bundle. Every command is executed for real.
LOC=$1; RID=$2
W=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave
S=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/libr2
NS=mobile.library
echo "# audit.log - delta of $RID, locale $LOC, $NS. Real output of $S/run.sh $LOC $RID, run $(date -u +%FT%TZ). Reads of call sites / sibling catalogues (sed/grep/python) are the auditor's own judgments and are not all replayed here."
run(){ echo; echo "\$ $*"; "$@" 2>&1 | grep -v "MODULE_TYPELESS_PACKAGE_JSON\|Reparsing as ES\|eliminate this warning\|trace-warnings"; echo "[exit ${PIPESTATUS[0]}]"; }
cd $W
run git rev-parse --short HEAD
run git status --short
run shasum -a 256 src/i18n/catalogues/$LOC/$NS.json src/i18n/catalogues/en/$NS.json src/i18n/catalogues/en/$NS.context.json src/i18n/catalogues/$LOC/mobile.common.json
run node scripts/i18n/generate.ts --check
run python3 $S/delta.py $LOC $RID
run python3 $S/checks.py $LOC
echo; echo "### rendered text, real args (limit=12; count=1,2,5), via src/i18n/messages.ts"
run node $S/render.ts $LOC
run grep -n "mobile.library.discard\|editor.discard_title\|mobile.common.cancel" src/features/library/library-detail.tsx src/ui/components/dialog.tsx
echo; echo "### re-hash at end of run (file must be unchanged)"
run shasum -a 256 src/i18n/catalogues/$LOC/$NS.json
