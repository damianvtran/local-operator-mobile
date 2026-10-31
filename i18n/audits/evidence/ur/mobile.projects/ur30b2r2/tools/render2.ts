// Delta render for group B round 2. Absolute imports; read-only on the worktree.
import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "<scratch>/ur-wave/src/i18n/messages";
const C="<scratch>/ur-wave/src/i18n/catalogues/";
const ld=(ns:string,l="ur")=>JSON.parse(readFileSync(`${C}${l}/mobile.${ns}.json`,"utf8"));
const U={...ld("schedules"),...ld("projects"),...ld("notifications"),...ld("computers")};
const E={...ld("schedules","en"),...ld("projects","en"),...ld("notifications","en"),...ld("computers","en")};
const R=(k:string,p:any={})=>formatMessage(parseMessage(U[k]),p,"ur");
const RE=(k:string,p:any={})=>formatMessage(parseMessage(E[k]),p,"en");
// 1. byte-exact whole-string comparison against the prescribed replacements
const WANT:Record<string,string>={
 "mobile.schedules.state.dormant":"خوابیدہ",
 "mobile.schedules.supervisor.not_running":"بیداریوں کی نگرانی کرنے والی سروس انسٹال تو ہے مگر چل نہیں رہی، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔",
 "mobile.projects.project_name_hint":"لمبائی 1 سے 64 حروف؛ نام میں صرف انگریزی حروف، 0 سے 9 تک ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔",
 "mobile.schedules.show_more.wakes":"{hidden, plural, one {# مزید بیداری دکھائیں} other {# مزید بیداریاں دکھائیں}}",
 "mobile.schedules.show_more.monitors":"{hidden, plural, one {# مزید نگرانی دکھائیں} other {# مزید نگرانیاں دکھائیں}}",
 "mobile.projects.draft_kept_note":"آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ کچھ نیا شروع کرنے کے لیے خانے صاف کریں۔",
 "mobile.computers.password_placeholder":"lop mobile سے ملنے والا پاس ورڈ",
};
for(const [k,w] of Object.entries(WANT)){
  const cur=U[k]; const ok=cur===w; const same=Buffer.from(cur,"utf8").equals(Buffer.from(w,"utf8"));
  console.log(`BYTE-EXACT ${ok&&same?"PASS":"FAIL"} ${k} (utf8 bytes ${Buffer.byteLength(cur,"utf8")})`);
  const pe=[...parseMessage(E[k]).params].sort().join(), pu=[...parseMessage(cur).params].sort().join();
  console.log(`   placeholder names en=[${pe}] ur=[${pu}] equal=${pe===pu}`);
}
// 2. dormant composed (as repl.ts S1): monitor header + dormant slot beside the sibling state slots
console.log("\n== head.* with dormant row slot ==");
for(const n of [1,3,21]){
  const a=R("mobile.schedules.due.ahead",{label:"4m"}), o=R("mobile.schedules.due.overdue",{label:"2h"});
  console.log(`n=${n} next : `+R("mobile.schedules.head.next",{head:R("mobile.schedules.summary.wakes",{count:n}),label:a}));
  console.log(`n=${n} overd: `+R("mobile.schedules.head.overdue",{head:R("mobile.schedules.summary.wakes",{count:n}),label:o}));
}
console.log("monitor header: "+R("mobile.schedules.summary.monitors_armed",{count:5})+" | "+R("mobile.schedules.summary.monitors_attention",{broken:2,total:5})+" | tail "+R("mobile.schedules.tail.failed",{count:3}));
console.log("state slots side by side: disabled=«"+U["mobile.schedules.state.disabled"]+"» dormant=«"+U["mobile.schedules.state.dormant"]+"» expired=«"+U["mobile.schedules.state.expired"]+"» stale=«"+U["mobile.schedules.state.stale"]+"» waiting=«"+U["mobile.schedules.state.waiting"]+"»");
console.log("parked clause (replaces whole head, distinct from dormant state): "+U["mobile.schedules.parked.monitors"]);
console.log("EN dormant row: "+E["mobile.schedules.state.dormant"]+" | EN parked: "+E["mobile.schedules.parked.monitors"]);
// 3. show_more
console.log("\n== show_more.* at hidden = 1, 2, 21 ==");
for(const f of ["wakes","monitors"]) for(const n of [1,2,21]) console.log(`${f} ${n}: `+R(`mobile.schedules.show_more.${f}`,{hidden:n})+"   | EN: "+RE(`mobile.schedules.show_more.${f}`,{hidden:n}));
// 4. supervisor trio
console.log("\n== supervisor.* x3 ==");
for(const k of ["not_running","unsupported","unverifiable"]) console.log(`${k}:\n   UR: ${U["mobile.schedules.supervisor."+k]}\n   EN: ${E["mobile.schedules.supervisor."+k]}`);
// 5. truncated + write_receipt unaffected (compare to round-1 expectations by direct render)
console.log("\n== truncated ==");
for(const [fam,t,s] of [["wakes",5,1],["monitors",5,2],["wakes",21,21]] as any) console.log(R("mobile.schedules.truncated",{family:fam,total:t,shown:s}));
console.log("\n== write_receipt (unchanged key; render all kind x action) ==");
for(const kind of ["project","milestone"]) for(const a of ["created","completed","reopened","added","updated","removed","deleted"]) console.log(kind,a,"=>",R("mobile.projects.write_receipt",{kind,action:a,subject:"alpha"}));
console.log("\n== project hint / draft note / placeholder ==");
console.log(R("mobile.projects.project_name_hint")); console.log(R("mobile.projects.draft_kept_note")); console.log(R("mobile.computers.password_placeholder"));
// 6. regex truth table for the hint
const re=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const cases:[string,string][]=[["alpha","ASCII letters"],["A9","mixed case+digit"],["a.b_c-d","dot underscore hyphen inside"],["x".repeat(64),"64 chars"],["x".repeat(65),"65 chars"],["","empty"],["a b","space"],["-x","leading hyphen"],[".x","leading dot"],["_x","leading underscore"],["پروجیکٹ","Urdu letters"],["é","accented Latin"],["٣٤","Arabic-Indic digits"],["۱۲","Extended Arabic-Indic digits"],["१२","Devanagari digits"]];
for(const [s,l] of cases) console.log(`regex ${re.test(s)?"ACCEPT":"REJECT"}  ${l}`);
