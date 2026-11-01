import json,re,sys,unicodedata
R='/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues/'
loc=sys.argv[1]
en=json.load(open(R+'en/mobile.library.json')); ctx=json.load(open(R+'en/mobile.library.context.json'))
d=json.load(open(R+loc+'/mobile.library.json'))
print('en keys',len(en),'sidecar keys',len(ctx),'sidecar==en',set(ctx)==set(en))
print(f'{loc}: keys={len(d)} same_keyset_as_en={set(d)==set(en)} all_values_str={all(isinstance(v,str) and v for v in d.values())}')
BIDI=re.compile('[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u061c]')
print('bidi/zero-width chars:',sum(len(BIDI.findall(v)) for v in d.values()))
print('Cf/Cc:',[(k,hex(ord(c))) for k,v in d.items() for c in v if unicodedata.category(c) in('Cf','Cc')])
print('NFC-stable:',all(unicodedata.normalize('NFC',v)==v for v in d.values()))
print('leading/trailing space:',[k for k,v in d.items() if v!=v.strip()])
print('U+FFFD / mojibake markers:',[k for k,v in d.items() if '\ufffd' in v or re.search('Ã.|Â.|â€',v)])
bad=[]
for k,v in d.items():
    e=en[k]
    if re.findall(r'\{(\w+)',e)!=re.findall(r'\{(\w+)',v): bad.append((k,'placeholder'))
    if 'plural' in v or 'select' in v: bad.append((k,'unexpected ICU arm'))
    if v.count('{')!=v.count('}'): bad.append((k,'brace'))
print('placeholder/ICU defects:',bad or 'none')
stops={'zh-CN':'。'}.get(loc,'.')
sent=[k for k,e in en.items() if e.endswith('.')]
print('sentence keys (en ends with .):',len(sent))
print('full-stop mismatch (locale stop vs en):',[k for k,v in d.items() if (en[k].endswith('.'))!=v.endswith(stops)] or 'none')
print('ASCII-quote / ASCII apostrophe in values:',[k for k,v in d.items() if "'" in v or '"' in v] or 'none')
print('special spaces (NNBSP U+202F / NBSP U+00A0):',[(k,[hex(ord(c)) for c in v if c in '\u202f\u00a0']) for k,v in d.items() if '\u202f' in v or '\u00a0' in v])
ph=d['mobile.library.editor.new_tag_placeholder']
print('new_tag_placeholder',repr(ph),'matches server grammar ^[a-z0-9][a-z0-9_-]{0,23}$ :',bool(re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,23}',ph)))
print('mid-dot kept in filters_count:', ' · ' in d['mobile.library.browse.filters_count'])
print('discard_confirm != common cancel:')
c=json.load(open(R+loc+'/mobile.common.json')); print('   common.cancel =',repr(c['mobile.common.cancel']),'| discard_confirm =',repr(d['mobile.library.discard_confirm']),'| equal:',c['mobile.common.cancel']==d['mobile.library.discard_confirm'])
print('   common.save =',repr(c['mobile.common.save']))
print('length (chars) of button/chip/label values:')
for k in ['action.add_tag','action.edit','action.open_chat','browse.any_tag','browse.filters','browse.more_kinds','browse.sort','browse.status','browse.tag','discard_confirm','editor.discard_title','browse.search_placeholder']:
    kk='mobile.library.'+k; print(f'   {k:28} {len(d[kk]):3} chars (en {len(en[kk])})  {d[kk]}')
