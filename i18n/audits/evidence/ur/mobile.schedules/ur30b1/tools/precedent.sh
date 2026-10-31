#!/bin/bash
# Second real-run section: ASCII-punctuation scan, core-precedent greps, fribidi visual order.
W=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave
S=/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-audit-b
echo '$ python3 ASCII-punctuation scan of ur values (outside {…} placeholders), ns schedules/projects/notifications/computers'
python3 - <<'P'
import json,re
C='/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/catalogues/ur/'
n=0
for ns in ['schedules','projects','notifications','computers']:
    for k,v in json.load(open(f'{C}mobile.{ns}.json',encoding='utf8')).items():
        flat=v
        for _ in range(6): flat=re.sub(r'\{[^{}]*\}','',flat)   # strip ICU/placeholders
        m=re.findall(r'[,;?]',flat)
        if m: print('ASCII , ; ?',k,m); n+=1
print('ascii-punct findings:',n)
P
G="git -C /Users/damian/local-operator grep -hE"
echo; echo '## core ur precedent: dismiss'; $G 'relay.notifications.(row.dismiss|confirm.dismiss"|detail.dismiss")|tui.notifications.(hint_dismiss|dismissed)' origin/main -- 'local_operator/i18n/catalogues/ur/*.json' | cut -c1-170
echo '## core ur precedent: more (tags.more)'; $G 'relay.session.tags.more' origin/main -- 'local_operator/i18n/catalogues/ur/*.json' | cut -c1-170
echo '## core ur precedent: schedule due/overdue/cadence'; $G '"tui.schedule.(due_in|due_overdue|cadence_every|detail_next)"' origin/main -- 'local_operator/i18n/catalogues/ur/tui.schedule.json'
echo '## core ur precedent: supervisor sentence'; $G 'tui.schedule.notice_supervisor' origin/main -- 'local_operator/i18n/catalogues/ur/tui.schedule.json'
echo '## core ur: any "dormant"/"armed" rendering? (en grep then ur counterpart)'; $G '"tui.app.parked.dormant"|"tui.small.wake_panel.monitors_armed"' origin/main -- 'local_operator/i18n/catalogues/en/*.json' | cut -c1-170
echo '## core ur: notifications detail sections'; $G 'relay.notifications.detail.section.(from|history|projects)"' origin/main -- 'local_operator/i18n/catalogues/ur/relay.notifications.json'
echo; echo '$ mobile en hard-coded line next to stays_listed (not in catalogue):'; grep -n 'Connected to' $W/src/features/auth/computers.tsx
echo; echo '$ which sites use monitor header count (dormant counted as armed?)'; sed -n 478,490p $W/src/features/schedules/schedules-copy.ts; sed -n 576,590p $W/src/features/schedules/schedules-copy.ts
echo; echo '$ fribidi visual-order check (RTL paragraph)'; bash $S/bidi.sh 2>&1 | grep -v "illegal line count"
