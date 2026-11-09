#!/bin/bash
# usage: run.sh <fr|es|ru|vi|zh-CN>  - every command is executed for real; stdout is the audit.log of bundle libc-<loc>-r1.
LOC=$1
W=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave
S=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/libc
NS=mobile.library
echo "# audit.log - libc-$LOC-r1 $NS. Real output of $S/run.sh $LOC, run $(date -u +%FT%TZ). Reads of call sites / sibling catalogues (sed/grep/python) are the auditor's own and are not replayed here."
run(){ echo; echo "\$ $*"; "$@" 2>&1 | grep -v "MODULE_TYPELESS_PACKAGE_JSON\|Reparsing as ES\|eliminate this warning\|trace-warnings"; echo "[exit ${PIPESTATUS[0]}]"; }
cd $W
run git rev-parse --short HEAD
run git status --short -- src/i18n/catalogues/$LOC/$NS.json src/i18n/catalogues/en/$NS.json src/i18n/catalogues/en/$NS.context.json src/features/library/library-detail.tsx src/ui/components/dialog.tsx
run shasum -a 256 src/i18n/catalogues/$LOC/$NS.json src/i18n/catalogues/en/$NS.json src/i18n/catalogues/en/$NS.context.json src/i18n/catalogues/$LOC/mobile.common.json
run grep -n "mobile.library.discard\|mobile.library.editor.discard_title\|mobile.common.cancel" src/features/library/library-detail.tsx src/ui/components/dialog.tsx
run node scripts/i18n/generate.ts --check
run python3 $S/checks.py $LOC
echo; echo "### rendered text, real args (limit=12; count=1,2,5), via src/i18n/messages.ts, WITH any prescribed replacement beneath"
run node $S/render.ts $LOC $S/$LOC.repl.json
echo; echo "### re-hash at end of run (file must be unchanged)"
run shasum -a 256 src/i18n/catalogues/$LOC/$NS.json
