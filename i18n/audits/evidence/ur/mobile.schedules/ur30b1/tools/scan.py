import re,sys,hashlib
W='/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/catalogues/'
files=[]
for ns in ['schedules','projects','notifications','computers']:
    for l,e in [('ur','.json'),('en','.json'),('en','.context.json')]:
        files.append(f'{W}{l}/mobile.{ns}{e}')
bidi=re.compile('[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u200b-\u200d\ufeff]')
red=re.compile(r'REDACT|\[redacted|\[\*{3,}\]|<redacted>|█{2,}',re.I)
tb=tr=0
for f in files:
    t=open(f,encoding='utf8').read(); b=len(bidi.findall(t)); r=len(red.findall(t)); tb+=b; tr+=r
    print(f'{hashlib.sha256(t.encode()).hexdigest()[:16]} bidi/zw-ctrl={b} redaction-marker={r} {f.split("catalogues/")[1]}')
print('TOTAL bidi/zero-width control chars:',tb,'| TOTAL redaction markers:',tr)
# also Arabic-letter (non-Urdu) forms, ascii punctuation, doubled spaces
import json
for ns in ['schedules','projects','notifications','computers']:
    d=json.load(open(f'{W}ur/mobile.{ns}.json',encoding='utf8'))
    for k,v in d.items():
        for c in v:
            if c in '\u064a\u0643\u0629\u0649': print('ARABIC-FORM',k,hex(ord(c)))
        if re.search(r'  | ،| ۔|[\u0660-\u0669\u06f0-\u06f9]|[?]',v): print('SPACING/DIGIT/ASCII-?',k)
print('script/punctuation scan done')
