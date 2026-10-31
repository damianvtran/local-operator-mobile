#!/bin/bash
# usage: run.sh <ur|hi>  — every command here is executed for real; its output is the audit.log.
LOC=$1
W=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave
S=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/libb
C=/Users/damian/local-operator
NS=mobile.library
echo "# audit.log — libb-$LOC $NS. Real output of $S/run.sh $LOC, run $(date -u +%FT%TZ). Auditor reads (git/ls/grep/read) are not in this log; only the commands below."
run(){ echo; echo "\$ $*"; "$@" 2>&1 | grep -v "MODULE_TYPELESS_PACKAGE_JSON\|Reparsing as ES\|eliminate this warning\|trace-warnings"; echo "[exit ${PIPESTATUS[0]}]"; }
cd $W
run git rev-parse --short HEAD
run git status --short -- src/i18n/catalogues/$LOC/$NS.json src/i18n/catalogues/en/$NS.json src/i18n/catalogues/en/$NS.context.json
run shasum -a 256 src/i18n/catalogues/$LOC/$NS.json src/i18n/catalogues/en/$NS.json src/i18n/catalogues/en/$NS.context.json
run node scripts/i18n/generate.ts --check
run python3 $S/checks.py
run node $S/render.ts
echo; echo "(render.ts prints both locales; only the == $LOC block is audited here)"
echo; echo "### fit: cell widths (rich.cells.cell_len, core .venv)"
cd $C && run .venv/bin/python $S/fit.py
echo; echo "### core server tag grammar probe (core repo .venv, read-only import)"
cd $C && run .venv/bin/python $S/tagprobe.py
echo; echo "### glossary evidence from core's committed $LOC catalogues (read-only grep, bounded paths)"
CC=$C/local_operator/i18n/catalogues/$LOC
run grep -h -E "library_asset_not_found|library_content_missing|library_tag_limit|library_tag_name|librarian.title|library_tag_category|tray.label|description_clear_unsupported|display_narration.label|tui.authoring.discard|tui.authoring.kind|tui.schedule.detail_status|relay.session.tags.more|relay.chrome.drawer.library|tui.tags.empty" $CC/wire.errors.desktop.json $CC/wire.settings.json $CC/tui.authoring.json $CC/tui.schedule.json $CC/tui.tags.json $CC/relay.session.tags.json $CC/relay.chrome.json $CC/relay.chrome.json
echo; echo "### replacement rendering"
cd $W && run node $S/verify-repl.ts $LOC
