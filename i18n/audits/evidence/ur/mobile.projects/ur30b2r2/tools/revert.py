# Revert each prescribed replacement in the CURRENT ur file (textual, on the raw bytes) and compare
# sha256 with the round-1 record.json input_hashes.ur. Equality proves no other key changed.
import json,hashlib
W='/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/'
B=W+'i18n/audits/evidence/ur/'
IDS={'schedules':'ur30b1','projects':'ur30b2','notifications':'ur30b3','computers':'ur30b4'}
OLDMON="{hidden, plural, one {# اور نگرانی دکھائیں} other {# اور نگرانیاں دکھائیں}}"
OLDWAKE="{hidden, plural, one {# اور بیداری دکھائیں} other {# اور بیداریاں دکھائیں}}"
SW={ # key -> old value (round-1 'current')
 'schedules':{'mobile.schedules.state.dormant':'غیر فعال',
  'mobile.schedules.supervisor.not_running':'بیداریوں کا سپروائزر انسٹال تو ہے مگر چل نہیں رہا، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔',
  'mobile.schedules.show_more.wakes':OLDWAKE,'mobile.schedules.show_more.monitors':OLDMON},
 'projects':{'mobile.projects.project_name_hint':'لمبائی 1 سے 64 حروف؛ نام میں الفبائی حروف، ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔',
  'mobile.projects.draft_kept_note':'آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ نئی چیز شروع کرنے کے لیے خانے صاف کریں۔'},
 'notifications':{},
 'computers':{'mobile.computers.password_placeholder':'وہ پاس ورڈ جو lop mobile سے ملا'}}
for ns,i in IDS.items():
    rec=json.load(open(f'{B}mobile.{ns}/{i}/record.json'))
    want=rec['input_hashes']['ur']['sha256']
    p=f'{W}src/i18n/catalogues/ur/mobile.{ns}.json'
    raw=open(p,'rb').read(); cur=hashlib.sha256(raw).hexdigest()
    d=json.loads(raw)
    txt=raw.decode('utf8')
    # also check: file serialises as json.dumps(indent?) -- report format
    for k,old in SW[ns].items():
        new=d[k]
        a=json.dumps(new,ensure_ascii=False); b=json.dumps(old,ensure_ascii=False)
        assert txt.count(a)==1,(k,txt.count(a))
        txt=txt.replace(a,b)
    rev=hashlib.sha256(txt.encode('utf8')).hexdigest()
    print(f'{ns}: swaps={len(SW[ns])} current={cur[:16]} reverted={rev[:16]} round1={want[:16]} MATCH={rev==want}')
    # en + context unchanged
    for kk in ('en','context'):
        h=hashlib.sha256(open(W+rec['input_hashes'][kk]['path'],'rb').read()).hexdigest()
        print(f'   {kk} unchanged={h==rec["input_hashes"][kk]["sha256"]}')
