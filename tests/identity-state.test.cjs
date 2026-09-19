const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {original,replacement,token,section,tick,rig}=require('./helpers/identity-runtime.cjs');
const adapter=fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8');
test('KPI URL and legacy cached tokens wait for Main verification; forged claims cannot authorize',async()=>{
 for(const cached of [false,true])for(const allowed of [false,true]){
  let finish,calls=0;const f=rig({verify:(app,t)=>{assert.equal(app,'app-kpi');assert.equal(t,token);calls++;return new Promise((resolve,reject)=>finish=()=>allowed?resolve(original):reject(Error('denied')));}});
  if(cached){f.window.location.search='';f.local.set('akra_sso_token',token);}
  const pending=f.c.resolveSsoAuth();await tick();assert.equal(calls,1);assert.equal(f.run('sessionToken'),null);
  finish();const result=await pending;assert.equal(Boolean(result.userData),allowed);
  if(allowed)assert.equal(result.userData.identityId,original.identityId);
 }
});
test('KPI bootstrap cannot overwrite a replaced app session or write Main shared storage',async()=>{
 let finish;const f=rig({verify:()=>new Promise(resolve=>finish=resolve)});
 f.local.set('akra_sso_token','main-token');f.local.set('akra_sso_user_data','main-user');
 const pending=f.c.resolveSsoAuth();await tick();f.local.set('akra_kpi_session','replacement-login');finish(original);await pending;
 assert.equal(f.local.get('akra_kpi_session'),'replacement-login');assert.equal(f.local.get('akra_sso_token'),'main-token');assert.equal(f.local.get('akra_sso_user_data'),'main-user');
 assert.equal(f.run('sessionToken'),null);
});
test('KPI drafts/preferences follow UUID while private read cache also follows session and revision',()=>{
 const f=rig();f.local.set('kpiData_AKRA','legacy-private');f.local.set('kpiDraft_reused-name_AKRA_2026-09-18_main','legacy-draft');
 assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);
 f.user();f.c.fixtureStorage.setItem('kpiData_AKRA','original-cache');f.c.fixtureStorage.setItem('kpiDraft_reused-name_AKRA_2026-09-18_main','original-draft');f.c.fixtureSessionStorage.setItem('active_branch','AKRA');
 f.user(replacement);assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_2026-09-18_main'),null);assert.equal(f.c.fixtureSessionStorage.getItem('active_branch'),null);
 f.user({...original,authorizationRevision:'rev-two'});assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_2026-09-18_main'),'original-draft');
 f.user({...original,sessionVersion:2});assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_2026-09-18_main'),'original-draft');
 f.user({...original,id:'renamed'});assert.equal(f.c.fixtureStorage.getItem('kpiDraft_renamed_AKRA_2026-09-18_main'),'original-draft');
 assert.equal(f.local.get('kpiData_AKRA'),'legacy-private');assert.equal(f.local.get('kpiDraft_reused-name_AKRA_2026-09-18_main'),'legacy-draft');
});
test('KPI cache reset preserves Main, other apps and unsaved drafts',()=>{
 const f=rig();f.user();f.local.set('akra_sso_token','main-token');f.local.set('other_sso_session','other');f.tab.set('returnitem-pending','uncertain');
 f.c.fixtureStorage.setItem('kpiData_AKRA','cache');f.c.fixtureStorage.setItem('kpiDraft_reused-name_AKRA_2026-09-18_main','draft');
 f.run(section('        function forceCleanCacheAndReload(','        function getTodayBangkokDateStr('));f.c.forceCleanCacheAndReload();
 assert.equal(f.local.get('akra_sso_token'),'main-token');assert.equal(f.local.get('other_sso_session'),'other');assert.equal(f.tab.get('returnitem-pending'),'uncertain');
 assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_2026-09-18_main'),'draft');assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);
});
test('KPI delayed config cannot populate another owner or another owner cache',async()=>{
 const f=rig();f.user();let finish,applied=0;
 f.c.processConfigList=()=>applied++;f.window.AkraSupabaseKPI=f.c.AkraSupabaseKPI={getConfig:()=>new Promise(resolve=>finish=resolve)};
 f.run(section('        async function loadConfig(','        async function refreshAdminStatus('));
 const pending=f.c.loadConfig();await tick();f.user(replacement,'new-token');finish({employees:[{uid:'old-owner'}],viewer:{name:'old'}});
 await pending.catch(()=>{});assert.equal(applied,0);assert.equal(f.c.fixtureStorage.getItem('kpi_cached_config'),null);
});
for(const action of ['getWorkloadData','saveWorkload'])test(`KPI actual client rejects late ${action} after page identity replacement`,async()=>{
 const f=rig();f.user();f.c.module={exports:{}};let finish;
 f.c.fetch=()=>new Promise(resolve=>finish=resolve);vm.runInContext(adapter,f.c);
 const pending=action==='saveWorkload'?f.c.module.exports.saveWorkload(token,'reused-name','2026-09-18',{}):f.c.module.exports.getWorkloadData(token,'AKRA',1);
 f.user(replacement,'new-token');finish({ok:true,json:async()=>({status:'success',records:[{id:'old'}],workload:[]})});
 await assert.rejects(pending,e=>e.reason==='session_changed');
});
test('KPI queued draft cannot save a former owner form into the replacement namespace',()=>{
 const f=rig();f.user();let callback,writes=0;
 f.c.setTimeout=fn=>{callback=fn;return 1;};f.c.saveRecordDraft=()=>writes++;
 f.run("currentBranch='AKRA';");
 f.run(section('        function saveRecordDraftDebounced(','        function clearRecordDraft('));
 f.c.saveRecordDraftDebounced();f.user(replacement,'new-token');callback();assert.equal(writes,0);
});
test('KPI failed old initialization cannot invalidate a replacement login',async()=>{
 const f=rig();let fail;
 f.c.checkAppVersion=async()=>true;f.c.AppVersionGuard={start(){}};f.c.CURRENT_VERSION='test';f.c.handleLineBrowserRedirect=()=>false;
 f.c.loadConfig=()=>new Promise((_,reject)=>fail=reject);f.c.checkAuth=async()=>{};
 f.run(section('        async function initSystem(','        // ตรวจ SSO token'));
 const pending=f.c.initSystem();await tick();f.user(replacement,'new-token');fail(Error('old failed'));await pending;
 assert.equal(f.run('kpiVerifiedSession.user.identityId'),replacement.identityId);
});
test('KPI pagination never returns a mixture after ownership changes during a later JSON body',async()=>{
 const f=rig();f.user();f.c.module={exports:{}};let finish,calls=0;
 f.c.fetch=async()=>({ok:true,json:async()=>{calls++;return calls===1?{status:'success',records:[{owner:'old'}],nextCursor:'next'}:new Promise(resolve=>finish=resolve);}});
 vm.runInContext(adapter,f.c);const pending=f.c.module.exports.fetchBranchData(token,'AKRA');await tick();
 assert.equal(calls,2);f.user(replacement,'new-token');finish({status:'success',records:[{owner:'new'}]});
 await assert.rejects(pending,e=>e.reason==='session_changed');assert.equal(calls,2);
});
test('KPI own-session storage event hides private UI and preserves the new login; unrelated app event is ignored',()=>{
 const f=rig();f.user();f.c.bindKpiSessionEvents();f.node('body').classList.add('kpi-session-ready');
 f.events.storage({key:'unrelated',oldValue:'old',newValue:'new'});assert.equal(f.run('sessionToken'),token);
 f.local.set('akra_kpi_session','new-login');f.events.storage({key:'akra_kpi_session',oldValue:'old',newValue:'new-login'});
 assert.equal(f.run('sessionToken'),null);assert.equal(f.node('body').classList.contains('kpi-session-ready'),false);
 assert.equal(f.node('kpi-session-status').hidden,false);assert.equal(f.local.get('akra_kpi_session'),'new-login');
});
test('KPI blocked browser storage retains only identity-scoped memory state and missing revision disables read reuse',()=>{
 const f=rig();f.c.localStorage.getItem=()=>{throw Error('blocked');};f.c.localStorage.setItem=()=>{throw Error('blocked');};
 f.user();f.c.fixtureStorage.setItem('kpiData_AKRA','original-cache');f.c.fixtureStorage.setItem('kpiDraft_reused-name_AKRA_day_main','draft');
 assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),'original-cache');
 f.user(replacement);assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_day_main'),null);
 f.user({...original,authorizationRevision:null});assert.equal(f.c.fixtureStorage.getItem('kpiData_AKRA'),null);assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_day_main'),'draft');
});
