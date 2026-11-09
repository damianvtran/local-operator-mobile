import json,hashlib,glob
W="/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave"
print("every mobile.common bundle: recorded target sha256 vs shipped bytes (r2 bundle of es excluded: it is this one)")
for l in ["es","fr","hi","ru","ur","vi","zh-CN"]:
    now=hashlib.sha256(open(f"{W}/src/i18n/catalogues/{l}/mobile.common.json","rb").read()).hexdigest()
    for p in sorted(glob.glob(f"{W}/i18n/audits/evidence/{l}/mobile.common/*/record.json")):
        r=json.load(open(p)); h=r["input_hashes"]["target"]["sha256"]
        en=hashlib.sha256(open(f"{W}/src/i18n/catalogues/en/mobile.common.json","rb").read()).hexdigest()==r["input_hashes"]["en"]["sha256"]
        cx=hashlib.sha256(open(f"{W}/src/i18n/catalogues/en/mobile.common.context.json","rb").read()).hexdigest()==r["input_hashes"]["context"]["sha256"]
        print(f"  {l:6} {r['audit_id']:18} target-match={h==now} en-match={en} ctx-match={cx}")
