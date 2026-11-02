"""Delta proof for one locale: (1) every round-1 finding with a replacement is byte-exact in the shipped file;
(2) the round-1 bytes are RECONSTRUCTED by reverting exactly those keys in the shipped raw bytes, and the sha256 of that
reconstruction is compared with the sha256 the round-1 bundle recorded - equality proves the changed-key set is exactly
that list (no other byte differs). Usage: delta.py <locale> <round1-id>"""
import json,sys,hashlib
W="/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave"
l,rid=sys.argv[1],sys.argv[2]
raw=open(f"{W}/src/i18n/catalogues/{l}/mobile.library.json",encoding="utf-8").read()
cur=json.loads(raw)
r1=json.load(open(f"{W}/i18n/audits/evidence/{l}/mobile.library/{rid}/record.json"))
want=r1["input_hashes"]["target"]["sha256"]
now=hashlib.sha256(raw.encode()).hexdigest()
print("round-1 recorded sha256 :",want); print("shipped now sha256      :",now); print("round-1 attests shipped :",want==now)
rec=raw; changed=[]
for f in r1["findings"]:
    k=f["key"]; rep=f.get("replacement","(none)")
    if not k.startswith("mobile.library.") or rep.startswith("("): 
        print(f'{f["id"]} {f["severity"]} {k}: no replacement prescribed (keep/observation)'); continue
    ok=cur[k]==rep
    print(f'{f["id"]} {f["severity"]} {k}\n   round-1 current    : {f["current"]}\n   round-1 replacement: {rep}\n   shipped now        : {cur[k]}\n   byte-exact applied : {ok}')
    a=json.dumps(rep,ensure_ascii=False); b=json.dumps(f["current"],ensure_ascii=False)
    assert rec.count(a)==1,("value not unique in file",k); rec=rec.replace(a,b); changed.append(k)
h=hashlib.sha256(rec.encode()).hexdigest()
print("keys changed since round 1 (derived):",changed)
print("reconstructed round-1 sha256:",h); print("== recorded round-1 sha256   :",h==want)
