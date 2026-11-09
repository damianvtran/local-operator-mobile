import json,re,unicodedata,sys
R='src/i18n/catalogues/'
en=json.load(open(R+'en/mobile.library.json')); ctx=json.load(open(R+'en/mobile.library.context.json'))
print('en keys',len(en),'ctx keys',len(ctx),'ctx==en keys',set(ctx)==set(en))
BIDI=re.compile('[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u200b-\u200d\u2060\ufeff]')
for loc,stop in (('ur','\u06d4'),('hi','\u0964')):
    d=json.load(open(f'{R}{loc}/mobile.library.json'))
    print(f'== {loc}: keys={len(d)} same_keyset_as_en={set(d)==set(en)} json_valid=True')
    print('bidi/zero-width/format characters in values:', sum(len(BIDI.findall(v)) for v in d.values()))
    print('Cf/Cc chars:', [hex(ord(c)) for v in d.values() for c in v if unicodedata.category(c) in ('Cf','Cc')])
    print('NFC-stable:', all(unicodedata.normalize('NFC',v)==v for v in d.values()))
    bad=[]
    for k,v in d.items():
        e=en[k]
        if set(re.findall(r'\{(\w+)',e))!=set(re.findall(r'\{(\w+)',v)): bad.append((k,'placeholder'))
        if e.endswith('.')!=v.endswith(stop): bad.append((k,'locale full stop vs source'))
        if v.endswith('.') : bad.append((k,'ASCII full stop'))
        if (not e.endswith('.')) and v[-1] in '\u06d4\u0964.': bad.append((k,'fragment gained stop'))
        if '{' in v and 'plural' in v: bad.append((k,'unexpected plural arm'))
    print('placeholder/full-stop defects:', bad or 'none')
    print('sentence keys in source:', [k for k,e in en.items() if e.endswith('.')])
    if loc=='ur': print('Arabic-form yeh/kaf (U+064A/U+0643):', sum(v.count('\u064a')+v.count('\u0643') for v in d.values()))
    if loc=='hi': print('ZWJ/ZWNJ:', sum(v.count('\u200d')+v.count('\u200c') for v in d.values()), ' non-nukta forms "फिल्टर":', sum('फिल्टर' in v for v in d.values()))
