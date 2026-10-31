import { readFileSync } from "node:fs";
import { parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/messages";
const C="/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/ur-wave/src/i18n/catalogues/";
let n=0,bad=0;
for(const ns of ["schedules","projects","notifications","computers"]){
 const en=JSON.parse(readFileSync(`${C}en/mobile.${ns}.json`,"utf8")),ur=JSON.parse(readFileSync(`${C}ur/mobile.${ns}.json`,"utf8"));
 const ek=Object.keys(en).sort().join(),uk=Object.keys(ur).sort().join();
 console.log(ns,"keys",Object.keys(en).length,Object.keys(ur).length,"keyset equal:",ek===uk);
 for(const k of Object.keys(en)){ n++;
  const a=[...parseMessage(en[k]).params].sort().join(), b=[...parseMessage(ur[k]).params].sort().join();
  if(a!==b){bad++;console.log("PARITY DIFF",k,a,"|",b);}
  if(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(ur[k])) console.log("BIDI CTRL",k);
 }}
console.log("keys checked",n,"param-parity mismatches",bad);
// negative control: a deliberately dropped placeholder must be detected
const a=[...parseMessage("{a} x {b}").params].sort().join(), b=[...parseMessage("{a} x").params].sort().join();
console.log("negative control detects drop:",a!==b, "| params example:",a);
