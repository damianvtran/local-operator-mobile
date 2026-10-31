// Renders each proposed replacement through the app's own parseMessage/formatMessage
// (no placeholder drift, parses, renders) next to the current string.
import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/messages";
const C="/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/catalogues/";
const ld=(ns:string,l="ur")=>JSON.parse(readFileSync(`${C}${l}/mobile.${ns}.json`,"utf8"));
const REPL:[string,string,any][]=[
 ["schedules","mobile.schedules.state.dormant","خوابیدہ",{}],
 ["computers","mobile.computers.password_placeholder","lop mobile سے ملنے والا پاس ورڈ",{}],
 ["schedules","mobile.schedules.supervisor.not_running","بیداریوں کی نگرانی کرنے والی سروس انسٹال تو ہے مگر چل نہیں رہی، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔",{}],
 ["projects","mobile.projects.project_name_hint","لمبائی 1 سے 64 حروف؛ نام میں صرف انگریزی حروف، 0 سے 9 تک ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔",{}],
 ["schedules","mobile.schedules.show_more.wakes","{hidden, plural, one {# مزید بیداری دکھائیں} other {# مزید بیداریاں دکھائیں}}",{hidden:1}],
 ["schedules","mobile.schedules.show_more.wakes","{hidden, plural, one {# مزید بیداری دکھائیں} other {# مزید بیداریاں دکھائیں}}",{hidden:21}],
 ["schedules","mobile.schedules.show_more.monitors","{hidden, plural, one {# مزید نگرانی دکھائیں} other {# مزید نگرانیاں دکھائیں}}",{hidden:2}],
 ["notifications","mobile.notifications.dismiss","خارج کریں",{}],
 ["projects","mobile.projects.draft_kept_note","آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ کچھ نیا شروع کرنے کے لیے خانے صاف کریں۔",{}],
];
for(const [ns,k,rep,p] of REPL){
 const cur=ld(ns)[k]; const en=ld(ns,"en")[k];
 const pe=[...parseMessage(en).params].sort().join(), pr=[...parseMessage(rep).params].sort().join();
 console.log(k,JSON.stringify(p));
 console.log("  BEFORE:",formatMessage(parseMessage(cur),p,"ur"));
 console.log("  AFTER :",formatMessage(parseMessage(rep),p,"ur"));
 console.log("  placeholder names vs en (kinds may widen text->plural):",pe,"|",pr);
}
// Composed-screen demonstration for S1: header + dormant row slot, before/after.
const U=ld("schedules");
const hdr=formatMessage(parseMessage(U["mobile.schedules.summary.monitors_armed"]),{count:5},"ur");
console.log("S1 composed BEFORE: header «"+hdr+"» + dormant row slot «"+U["mobile.schedules.state.dormant"]+"» + disabled row slot «"+U["mobile.schedules.state.disabled"]+"»");
console.log("S1 composed AFTER : header «"+hdr+"» + dormant row slot «خوابیدہ» + disabled row slot «"+U["mobile.schedules.state.disabled"]+"»");
console.log("S2 supervisor trio (current):"); for(const k of ["not_running","unsupported","unverifiable"]) console.log("   ",U["mobile.schedules.supervisor."+k]);
// Negative control for the name grammar: the sentence's claim vs the relay regex.
const re=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
console.log("name-grammar control (core projects._NAME_RE):",JSON.stringify({"پروجیکٹ":re.test("پروجیکٹ"),"alpha":re.test("alpha"),"٣٤":re.test("٣٤"),"_x":re.test("_x"),".x":re.test(".x"),"-x":re.test("-x")}));
