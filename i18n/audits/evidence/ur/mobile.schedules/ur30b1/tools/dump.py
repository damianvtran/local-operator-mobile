import json
C='/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/catalogues/'
for ns in ['schedules','projects','notifications','computers']:
    en=json.load(open(f'{C}en/mobile.{ns}.json')); ur=json.load(open(f'{C}ur/mobile.{ns}.json')); cx=json.load(open(f'{C}en/mobile.{ns}.context.json'))
    print('=====',ns,'en',len(en),'ur',len(ur),'keydiff',sorted(set(en)^set(ur)),'ctx',len(cx),'maxCells/maxChars hints:',sum(1 for v in cx.values() if 'maxCells' in v or 'maxChars' in v))
    for k in en:
        print('--',k); print('  EN:',en[k]); print('  UR:',ur[k]); print('  CX:',cx[k].get('role'),'|',cx[k].get('note'))
