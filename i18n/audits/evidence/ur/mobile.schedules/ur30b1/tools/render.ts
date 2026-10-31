import { readFileSync } from "node:fs";
import { formatMessage, parseMessage, pluralCategory } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/messages";
const C="/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/catalogues/";
const ld=(l:string,ns:string)=>JSON.parse(readFileSync(`${C}${l}/mobile.${ns}.json`,"utf8"));
const ur:any={...ld("ur","schedules"),...ld("ur","projects"),...ld("ur","notifications"),...ld("ur","computers")};
const en:any={...ld("en","schedules"),...ld("en","projects"),...ld("en","notifications"),...ld("en","computers")};
const R=(k:string,p:any={})=>formatMessage(parseMessage(ur[k]),p,"ur");
const E=(k:string,p:any={})=>formatMessage(parseMessage(en[k]),p,"en");
const P=(k:string,p:any)=>console.log(k.replace("mobile.",""),JSON.stringify(p),"\n   UR:",R(k,p),"\n   EN:",E(k,p));
console.log("PluralRules ur:",[0,1,2,21,100].map(n=>n+":"+new Intl.PluralRules("ur").select(n)).join(" "), "| pluralCategory:",[0,1,2,21].map(n=>pluralCategory("ur",n)).join(","));
// parity
for(const k of Object.keys(en)){
  const a=parseMessage(en[k]) as any,b=parseMessage(ur[k]) as any;
  const names=(m:any)=>JSON.stringify(Object.entries(m.arguments??m.args??{}).sort());
  if(names(a)!==names(b)) console.log("PARITY DIFF",k,names(a),names(b));
}
console.log("parsed all keys OK",Object.keys(en).length);
for(const n of [0,1,2,21]){ for(const k of ["count.wakes","count.monitors","sessions.count"]) P(k.startsWith("sessions")?"mobile.projects."+k:"mobile.schedules."+k,{count:n}); }
for(const n of [1,2,21]){P("mobile.schedules.show_more.wakes",{hidden:n});P("mobile.schedules.show_more.monitors",{hidden:n});}
for(const f of ["wakes","monitors","zzz"]) for(const [s,t] of [[0,0],[1,1],[1,2],[2,5],[21,22],[3,1]]) P("mobile.schedules.truncated",{shown:s,total:t,family:f});
for(const d of ["4m","2h","1h30m","45s","8d"]){ P("mobile.schedules.due.ahead",{label:d}); P("mobile.schedules.due.overdue",{label:d}); }
const cnt=(n:number)=>R("mobile.schedules.count.wakes",{count:n});
for(const [n,d] of [[3,"4m"],[1,"2h"],[2,"1h30m"],[21,"45s"]] as any){
  const a=R("mobile.schedules.due.ahead",{label:d}), o=R("mobile.schedules.due.overdue",{label:d});
  console.log("HEAD next:",R("mobile.schedules.head.next",{head:cnt(n),label:a}));
  console.log("HEAD overdue:",R("mobile.schedules.head.overdue",{head:cnt(n),label:o}));
}
const cad=(d:string)=>R("mobile.schedules.cadence.every",{duration:d});
console.log("CADENCE",cad("1d"),"|",R("mobile.schedules.cadence.left",{cadence:cad("1d"),remaining:3}),"|",R("mobile.schedules.cadence.spent",{cadence:cad("1h30m")}),"|",R("mobile.schedules.cadence.once"));
P("mobile.schedules.summary.monitors_armed",{count:5});P("mobile.schedules.summary.monitors_attention",{broken:2,total:5});P("mobile.schedules.summary.wakes",{count:3});P("mobile.schedules.tail.failed",{count:3});
for(const n of [0,1,2,21]) P("mobile.projects.sessions.count",{count:n});
console.log(R("mobile.projects.sessions.live",{base:R("mobile.projects.sessions.count",{count:3}),live:2}));
console.log(R("mobile.projects.milestones.count",{completed:2,total:5}),"|",R("mobile.projects.milestones.none"));
console.log("JOIN:",R("mobile.projects.milestones.count",{completed:2,total:5})+" · "+R("mobile.projects.sessions.count",{count:3}));
for(const k of ["delete_body","remove_milestone_body"]) P("mobile.projects."+k,{name:"my-proj"});
for(const kind of ["project","milestone","other","zzz"]) for(const a of ["created","completed","reopened","added","updated","removed","deleted","zzz"]) console.log(kind,a,"=>",R("mobile.projects.write_receipt",{kind,action:a,subject:"alpha"}),"   | EN:",E("mobile.projects.write_receipt",{kind,action:a,subject:"alpha"}));
