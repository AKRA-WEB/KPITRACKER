const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(name){const pattern=new RegExp('        (?:async )?function '+name+'\\(');const start=html.search(pattern);assert.ok(start>=0,name);const tail=html.slice(start+1),next=tail.search(/\n        (?:async )?function \w+\(/);assert.ok(next>=0,name+' boundary');return html.slice(start,start+1+next);}
test('UI self capability preserves old AKRA roles, denies missing/revoked/malformed grants and never infers from adminDashboard/manageWorkload',()=>{
  const p=require('../js/workload-permissions.js');
  for(const role of ['ADMIN','SUPERVISOR','AKRA','WAREHOUSE']){
    assert.equal(p.canRecordSelf([role],'fixture',{}),true);
    for(const perms of [[],['adminDashboard'],['manageWorkload']])assert.equal(p.canRecordSelf([role],'fixture',{permissionCatalog:{'app-kpi':['recordWorkload']},perms:{'app-kpi':perms}}),false);
    assert.equal(p.canRecordSelf([role],'fixture',{permissionCatalog:{'app-kpi':['recordWorkload']},perms:{'app-kpi':['recordWorkload']}}),true);
  }
  for(const role of ['TRD','CUSTOM'])assert.equal(p.canRecordSelf([role],'fixture',{perms:{'app-kpi':['recordWorkload']}}),false);
  assert.equal(p.canRecordSelf(['WAREHOUSE'],'',{}),false);
  for(const permissionCatalog of [null,[],{'app-kpi':null}])assert.equal(p.canRecordSelf(['WAREHOUSE'],'fixture',{permissionCatalog}),false);
});
test('Every actual self-write entrypoint stops before form access/confirmation/network when permission was removed',async()=>{
  let denied=0;const c=vm.createContext({requireOwnWorkloadPermission(){denied++;return false;}});
  const names=['confirmQuickWorkloadSave','submitQuickWorkload','saveWorkloadCard','executeSaveWorkload','clearWorkloadCard'];
  for(const name of names){vm.runInContext(source(name),c);await c[name]();}
  assert.equal(denied,names.length);
});
test('Quick Workload never reports success/closes LINE when API is absent or returns failure; confirmed persistence reports once',async()=>{
  for(const [api,success] of [[null,false],[{saveWorkload:async()=>({status:'error'})},false],[{saveWorkload:async()=>{throw Error('fixture failure');}},false],[{saveWorkload:async()=>({status:'success',workload:[]})},true]]){
    const toasts=[],modals=[],timers=[],btn={};const c=vm.createContext({requireOwnWorkloadPermission:()=>true,canRecordOwnWorkload:()=>true,QUICK_WORKLOAD_STATE:{primaryCore:'คลัง W1',primaryHours:10,totalHours:10,hasSupport:false},currentUser:'fixture',displayUserName:'Fixture',sessionToken:'fixture-token',getTodayBangkokDateStr:()=> '2026-09-17',document:{getElementById:()=>btn},window:{AkraSupabaseKPI:api},AkraSupabaseKPI:api,showToast:x=>toasts.push(x),showModal:(...x)=>modals.push(x),setTimeout:fn=>timers.push(fn),console:{error(){}}});
    vm.runInContext(source('submitQuickWorkload'),c);await c.submitQuickWorkload();
    assert.equal(toasts.length,success?1:0);assert.equal(timers.length,success?1:0);assert.equal(modals.length,success?0:1);
    assert.equal(btn.disabled,false);
  }
});
