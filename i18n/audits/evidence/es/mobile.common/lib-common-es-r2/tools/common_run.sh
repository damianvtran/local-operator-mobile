#!/bin/bash
W=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave
S=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/libr2
CORE=/Users/damian/local-operator/local_operator/i18n/catalogues
echo "# audit.log - delta of lib-common-es-r1, locale es, mobile.common. Real output of $S/common_run.sh, run $(date -u +%FT%TZ). Judgments are the auditor's own."
run(){ echo; echo "\$ $*"; "$@" 2>&1 | grep -v "MODULE_TYPELESS_PACKAGE_JSON\|Reparsing as ES\|eliminate this warning\|trace-warnings"; echo "[exit ${PIPESTATUS[0]}]"; }
cd $W
run git rev-parse --short HEAD
run git diff HEAD -- src/i18n/catalogues/es/mobile.common.json
run shasum -a 256 src/i18n/catalogues/es/mobile.common.json src/i18n/catalogues/en/mobile.common.json src/i18n/catalogues/en/mobile.common.context.json
run node scripts/i18n/generate.ts --check
run python3 $S/common_delta.py
run node $S/common_render.ts
run grep -rn "mobile.common.done" src --include=*.tsx --include=*.ts --exclude=catalogue.gen.ts
run grep -n "relay.session.tags.done" $CORE/es/relay.session.tags.json $CORE/en/relay.session.tags.json
run grep -n -A3 "relay.session.tags.done" $CORE/en/relay.session.tags.context.json
run grep -n -A3 "mobile.common.done" src/i18n/catalogues/en/mobile.common.context.json
run grep -n "Listo\|Hecho" src/i18n/catalogues/es/mobile.account_routing.json src/i18n/catalogues/es/mobile.common.json src/i18n/catalogues/es/mobile.computers.json src/i18n/catalogues/es/mobile.home.json src/i18n/catalogues/es/mobile.library.json src/i18n/catalogues/es/mobile.notifications.json src/i18n/catalogues/es/mobile.projects.json src/i18n/catalogues/es/mobile.schedules.json src/i18n/catalogues/es/mobile.session.json src/i18n/catalogues/es/mobile.session_health.json
run python3 $S/common_stale.py
echo; echo "### re-hash at end of run (file must be unchanged)"
run shasum -a 256 src/i18n/catalogues/es/mobile.common.json
