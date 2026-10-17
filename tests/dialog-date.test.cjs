// Actual candidate dialogs and caller functions, synthetic API/DOM only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {rig,tick}=require('./helpers/bm-dialog-runtime.cjs');
const html=fs.readFileSync(process.env.BM_DIALOG_UI_SOURCE||path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
const source=name=>{const start=html.search(new RegExp('        (?:async )?function '+name+'\\(')),end=html.indexOf('\n        }',start)+'\n        }'.length;assert(start>=0&&end>start,name);return html.slice(start,end);};
function page(){
 const f=rig(),calls=[],notices=[];f.c.IS_ADMIN=true;f.c.AkraSupabaseKPI=f.window.AkraSupabaseKPI={};
 for(const key of ['deleteSkillCatalogItem','deleteEmployeeSkill','clearWorkload','deleteIncident'])f.c.AkraSupabaseKPI[key]=async(...args)=>{calls.push({key,args});return{status:'success',skills:[],incidents:[],zeroConfirmed:false};};
 for(const key of ['renderAdminSkillsSettings','renderAdminWorkloadSettings','renderAdminIncidentSettings','renderRecordActionsTable','saveRecordDraftDebounced','renderErrTimeline','renderErrTeamHp','loadDashboardData','updateDailyDashboard','applyIncidentSaveResultToCache','applyWorkloadSaveResultToCache','renderAkraWorkloadEditor','renderTeamWorkloadPreview'])f.c[key]=()=>{};
 f.c.showToast=(...args)=>notices.push(args);f.c.showModal=(...args)=>notices.push(args);f.c.requireOwnWorkloadPermission=()=>true;f.c.canRecordOwnWorkload=()=>true;f.c.AppVersionGuard={blockIfStale:async()=>false};f.c.getTodayBangkokDateStr=()=> '2026-10-12';f.c.syncDataFromSheet=async()=>{};f.c.safeStorage={removeItem(){}};
 f.c.ADMIN_SETTINGS_STATE={workloadDuties:{primaryDuties:[{name:'A'},{name:'B'}]},incidentCatalog:{AKRA:{categories:[{key:'a',label:'A'},{key:'b',label:'B'}],items:{a:[1],b:[2]}}}};
 f.c.localActionsDraft=[{actionId:'a'},{actionId:'b'}];f.node('record-date-error').value='2026-10-12';
 for(const name of ['deleteSkillCatalogItem','revokeEmployeeSkill','deleteAdminDuty','deleteAdminCategory','deleteLocalAction','deleteErrorCase','clearWorkloadCard'])f.run(source(name));
 return{...f,calls,notices};
}
test('actual native caller baseline and candidate: cancellation has no API/local deletion and no window dialog',async()=>{
 for(const [name,args] of [['deleteSkillCatalogItem',['skill']],['revokeEmployeeSkill',['u2','skill']],['deleteErrorCase',['case']],['clearWorkloadCard',[]],['deleteAdminDuty',['primary',0]],['deleteAdminCategory',['AKRA','a']],['deleteLocalAction',['a']]]){
  const f=page(),pending=f.c[name](...args);await tick();f.button('ยกเลิก')?.dispatch('click');await pending;
  assert.equal(f.calls.length,0,name);assert.equal(f.native.length,0,name+' must use in-page dialog');assert.equal(f.c.localActionsDraft.length,2);assert.equal(f.c.ADMIN_SETTINGS_STATE.workloadDuties.primaryDuties.length,2);assert.equal(f.c.ADMIN_SETTINGS_STATE.incidentCatalog.AKRA.categories.length,2);
 }
});
test('confirmation sends each original mutation payload once; double activation stays locked through response',async()=>{
 for(const [name,args,key,expected] of [['deleteSkillCatalogItem',['skill'],'deleteSkillCatalogItem',['token','skill']],['revokeEmployeeSkill',['u2','skill'],'deleteEmployeeSkill',['token','u2','skill']],['deleteErrorCase',['case'],'deleteIncident',['token','AKRA','2026-10-12','case']],['clearWorkloadCard',[],'clearWorkload',['token','u1','2026-10-12']]]){
  const f=page();let finish;f.c.AkraSupabaseKPI[key]=(...values)=>{f.calls.push({key,args:values});return new Promise(resolve=>finish=resolve);};
  const pending=f.c[name](...args);await tick();const duplicate=f.c[name](...args);await tick();f.button('ยืนยัน').dispatch('click');await tick();assert.equal(f.calls.length,1,name);assert.deepEqual(Array.from(f.calls[0].args),expected);
  const repeat=f.c[name](...args);await tick();assert.equal(f.dialog(),undefined);finish({status:'success',skills:[],incidents:[]});await Promise.all([pending,duplicate,repeat]);assert.equal(f.calls.length,1);
 }
});
test('changed owner/token/branch/date while awaiting confirmation causes zero writes',async()=>{
 for(const changed of ['owner','sessionToken','currentBranch','date']){const f=page(),pending=f.c.deleteErrorCase('case');await tick();if(changed==='date')f.node('record-date').value='2026-10-11';else f.c[changed]=changed==='owner'?{}:'replacement';f.button('ยืนยัน').dispatch('click');await pending;assert.equal(f.calls.length,0,changed);}
});
test('local deletion keeps original object identity and blocks stale list index after confirmation',async()=>{
 const f=page(),pending=f.c.deleteAdminDuty('primary',0);await tick();f.c.ADMIN_SETTINGS_STATE.workloadDuties.primaryDuties.unshift({name:'new'});f.button('ยืนยัน').dispatch('click');await pending;assert.equal(f.c.ADMIN_SETTINGS_STATE.workloadDuties.primaryDuties.length,3);
 const g=page(),p=g.c.deleteLocalAction('a');await tick();g.button('ยืนยัน').dispatch('click');await p;assert.deepEqual(Array.from(g.c.localActionsDraft,a=>a.actionId),['b']);
});
test('dialog traps Tab/Shift+Tab, Escape cancels, one-shot click and same-owner focus return',async()=>{
 const f=rig(),origin=f.node('origin');origin.focus();let count=0;const pending=f.window.BMDialog.run('action','message',async()=>count++);const dialog=f.dialog();assert.equal(f.document.activeElement,f.button('ยกเลิก'));
 dialog.dispatch('keydown',{key:'Tab'});assert.equal(f.document.activeElement,f.button('ยืนยัน'));dialog.dispatch('keydown',{key:'Tab'});assert.equal(f.document.activeElement,f.button('ยกเลิก'));dialog.dispatch('keydown',{key:'Tab',shiftKey:true});assert.equal(f.document.activeElement,f.button('ยืนยัน'));
 const confirm=f.button('ยืนยัน');confirm.dispatch('click');confirm.dispatch('click');await pending;assert.equal(count,1);assert.equal(f.document.activeElement,origin);
 const cancel=f.window.BMDialog.run('cancel','message',()=>count++);f.dialog().dispatch('keydown',{key:'Escape'});await cancel;assert.equal(count,1);assert.equal(f.document.activeElement,origin);
 const stale=f.window.BMDialog.ask('message');f.c.owner={id:2};f.window.BMDialog.cancel();assert.equal(await stale,false);assert.notEqual(f.document.activeElement,origin);
});
test('unknown mutation failure retains caller recovery and never auto-resends',async()=>{
 const f=page();f.c.AkraSupabaseKPI.deleteIncident=async(...args)=>{f.calls.push(args);throw Error('unknown outcome');};const p=f.c.deleteErrorCase('case');await tick();f.button('ยืนยัน').dispatch('click');await p;assert.equal(f.calls.length,1);assert.ok(f.notices.some(row=>row.includes('unknown outcome')));assert.equal(f.dialog(),undefined);
});
test('BE display distinguishes Gregorian ISO, documented legacy CE/BE, date-only and Bangkok timestamps',()=>{
 const c=vm.createContext({window:{},Date,Intl});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/bm-date-display.js'),'utf8'),c);const display=c.window.BMDateDisplay;
 for(const input of ['2026-10-12','12/10/2026','12/10/2569','12/10/26'])assert.equal(display.date(input),'12 ต.ค. 2569',input);
 assert.equal(display.date('2569-10-12'),'12 ต.ค. 3112');assert.equal(display.date('2026-10-11T18:01:00Z'),'12 ต.ค. 2569');assert.equal(display.dateTime('2026-10-11T18:01:00Z'),'12 ต.ค. 2569 - 01:01:00');assert.equal(display.dateTime('2026-10-12'),'12 ต.ค. 2569');assert.equal(display.dateTime('12/10/2569 08:10:12'),'12 ต.ค. 2569 - 08:10:12');
 for(const input of ['2026-02-30','2026-02-30T18:01:00Z','31/04/2569','2026-10-12T24:00','bad'])assert.equal(display.date(input),input);
 vm.runInContext(source('formatExecutiveDate')+'\n'+source('formatDailyDashboardTimestamp'),c);
 assert.equal(c.formatExecutiveDate('2026-10-12'),'12 ต.ค. 2569');assert.equal(c.formatDailyDashboardTimestamp(Date.parse('2026-10-11T18:01:00Z')),'12 ต.ค. 2569 - 01:01:00');
});

test('legacy zero-error confirmation cancel/owner fence writes nothing; confirm preserves original section payload once',async()=>{
 for(const decision of ['cancel','stale','confirm']){
  const f=page(),writes=[];f.c.saveRecordDraft=()=>{};f.c.encodeAkraCaseMeta=meta=>JSON.stringify(meta);f.c.getAkraOnDutyEmployees=()=>[];f.c.getAkraCoreRoster=()=>[];f.c.prepareTrdErrorEntriesForNextSave=()=>{};f.c.sendAppLog=()=>{};
  f.c.postToKpiApi=async payload=>{writes.push(payload);return{status:'success'};};f.node('btn-save-errors');f.run(source('saveErrorsCard'));const p=f.c.saveErrorsCard();await tick();const repeat=f.c.saveErrorsCard();if(decision==='stale')f.c.sessionToken='replacement';f.button(decision==='cancel'?'ยกเลิก':'ยืนยัน').dispatch('click');await Promise.all([p,repeat]);assert.equal(writes.length,decision==='confirm'?1:0);
  if(writes.length){assert.equal(writes[0].action,'saveSection');assert.equal(writes[0].branch,'AKRA');assert.equal(writes[0].date,'2026-10-12');assert.equal(writes[0].section,'errors');assert.equal(writes[0].errors.length,1);assert.equal(writes[0].errors[0].caseId,'NO_ERRORS');assert.equal(writes[0].errors[0].emp,'SYSTEM');}
 }
});

test('actual standalone bridge leave cancellation/busy/owner change cannot navigate; confirmed route stays exact',async()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'../js/akra-shell-bridge.js'),'utf8').replace(/\r\n/g,'\n');
 const extract=name=>{const start=bridge.search(new RegExp('    (?:async )?function '+name+'\\(')),end=bridge.indexOf('\n    }',start)+'\n    }'.length;return bridge.slice(start,end);};
 for(const decision of ['cancel','busy','stale','confirm']){const f=rig(),routes=[];f.window.AkraModule={sessionStamp:()=> 'main',getWorkState:()=>({dirty:true,busy:decision==='busy'}),prepareLeave:()=>routes.push('prepare')};f.window.location={assign:route=>routes.push(route)};f.run(extract('confirmStandaloneLeave'));f.run(extract('switchStandalone'));const p=f.c.switchStandalone('/exact/');if(decision==='stale')f.c.owner={};f.button(decision==='cancel'?'ยกเลิก':decision==='busy'?'ตกลง':'ยืนยัน').dispatch('click');await p;assert.deepEqual(routes,decision==='confirm'?['prepare','/exact/']:[]);}
});
