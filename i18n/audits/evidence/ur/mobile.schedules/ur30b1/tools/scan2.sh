#!/bin/bash
# Redaction-marker + bidi-control scan over the NON-catalogue inputs read through git (style guide, glossary, core ur files).
G="git -C <core> show"
tot=0
for f in i18n/style-guides/ur.md i18n/glossary.md local_operator/i18n/catalogues/ur/tui.schedule.json local_operator/i18n/catalogues/ur/relay.notifications.json local_operator/i18n/catalogues/ur/tui.notifications.json local_operator/projects.py; do
  n=$($G origin/main:$f | python3 -c "import re,sys;t=sys.stdin.read();print(len(re.findall(r'REDACT|\[redacted|\[\*{3,}\]|<redacted>|█{2,}',t,re.I)))")
  b=$($G origin/main:$f | python3 -c "import re,sys;t=sys.stdin.read();print(len(re.findall('[\u200e\u200f\u202a-\u202e\u2066-\u2069]',t)))")
  echo "redaction=$n bidi-ctrl=$b origin/main:$f"; tot=$((tot+n))
done
echo "TOTAL redaction markers in git-read inputs: $tot"
