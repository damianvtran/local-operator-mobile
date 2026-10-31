import json,hashlib,re,unicodedata
W="/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave"
raw=open(f"{W}/src/i18n/catalogues/es/mobile.common.json",encoding="utf-8").read(); cur=json.loads(raw)
en=json.load(open(f"{W}/src/i18n/catalogues/en/mobile.common.json")); ctx=json.load(open(f"{W}/src/i18n/catalogues/en/mobile.common.context.json"))
r1=json.load(open(f"{W}/i18n/audits/evidence/es/mobile.common/lib-common-es-r1/record.json"))
want=r1["input_hashes"]["target"]["sha256"]; now=hashlib.sha256(raw.encode()).hexdigest()
print("round-1 recorded sha256 :",want);print("shipped now sha256      :",now);print("round-1 attests shipped :",want==now)
a=json.dumps("Hecho",ensure_ascii=False);b=json.dumps("Listo",ensure_ascii=False)
assert raw.count(a)==1
rec=raw.replace(a,b); h=hashlib.sha256(rec.encode()).hexdigest()
print("keys changed since round 1 (derived): ['mobile.common.done']  Listo -> Hecho")
print("reconstructed round-1 sha256:",h);print("== recorded round-1 sha256   :",h==want)
print("keys:",len(cur),"same_keyset_as_en:",set(cur)==set(en),"sidecar==en:",set(ctx)==set(en),"all non-empty str:",all(isinstance(v,str) and v for v in cur.values()))
print("Cf/Cc:",[k for k,v in cur.items() for c in v if unicodedata.category(c) in("Cf","Cc")],"NFC:",all(unicodedata.normalize('NFC',v)==v for v in cur.values()),"trim-clean:",all(v==v.strip() for v in cur.values()))
print("placeholders/ICU/trailing stop:",[k for k,v in cur.items() if re.search(r'[{}]',v) or v.endswith('.')] or "none")
print("distinct values (no two verbs collapse):",len(set(cur.values()))==len(cur), cur)
