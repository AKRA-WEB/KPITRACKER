// Actual page startup/config functions, authentic session fencing and synthetic API only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {rig:identityRig,original,token,tick}=require('./helpers/identity-runtime.cjs');
const html=fs.readFileSync(process.env.KPI_UI_SOURCE||path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
const source=name=>{const start=html.search(new RegExp('        (?:async )?function '+name+'\\(')),end=html.indexOf('\n        }',start)+'\n        }'.length;assert(start>=0&&end>start,name);return html.slice(start,end);};
function fixture(){
 const f=identityRig();f.user();const requests=[];f.c.checkAppVersion=async()=>true;f.c.AppVersionGuard={start(){}};f.c.handleLineBrowserRedirect=()=>false;
 f.c.resolveSsoAuth=async()=>({userData:original});f.c.startStartupActivityPrefetch=()=>null;f.c.clearStartupActivityPrefetch=()=>{};f.c.activateStartupActivityPrefetch=()=>{};
 f.c.checkAuth=async()=>{f.node('body').classList.add('kpi-session-ready');f.node('kpi-session-status').hidden=true;};
 f.c.AkraSupabaseKPI=f.window.AkraSupabaseKPI={...require('../js/supabase-kpi-client.js'),getConfig:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))};
 f.run(source('loadConfig'));f.run(source('initSystem'));f.c.CURRENT_VERSION='fixture';
 return{...f,requests};
}
test('configuration transport failure preserves verified identity and presents actionable read retry',async()=>{
 for(const error of [new TypeError('offline'),Object.assign(new Error('raw_internal_detail'),{reason:'internal_error',status:500}),Object.assign(new Error('request_timeout'),{reason:'request_timeout'})]){
  const f=fixture(),pending=f.c.initSystem();await tick();f.requests[0].reject(error);await pending;
  assert.equal(f.run('sessionToken'),token,'read failure must not retire an already verified session');assert.equal(f.node('kpi-startup-retry').hidden,false);assert.match(f.node('kpi-session-message').textContent,error.status===500?/ระบบขัดข้องชั่วคราว/:/เชื่อมต่อไม่ได้/);assert.doesNotMatch(f.node('kpi-session-message').textContent,/raw_internal_detail|เซสชันหมดอายุ/);
 }
});
test('single-flight startup retry recovers with reads and hides its failure after fresh config',async()=>{
 const f=fixture();const first=f.c.initSystem();await tick();f.requests[0].reject(new TypeError('offline'));await first;
 const retry=f.c.retryKpiStartup();await tick();const duplicate=f.c.retryKpiStartup();assert.equal(f.requests.length,2);
 f.requests[1].resolve({employees:[{uid:'fixture',name:'พนักงานทดสอบ',status:'Active'}],viewer:{roles:['ADMIN']}});await Promise.all([retry,duplicate]);assert.equal(f.node('kpi-session-status').hidden,true);assert.equal(f.run('sessionToken'),token);
});
test('read classifier keeps reason before status and preserves conflict/cancellation semantics',()=>{
 const describe=require('../js/supabase-kpi-client.js').describeReadError;assert.equal(typeof describe,'function');
 assert.equal(describe({reason:'invalid_or_expired_token',status:403}).kind,'session');assert.equal(describe({reason:'permission_denied',status:500}).kind,'permission');
 assert.equal(describe({reason:'record_conflict',status:409}).kind,'conflict');assert.equal(describe({status:429}).kind,'rate-limit');
 assert.equal(describe({reason:'session_changed'}),null);assert.equal(describe({name:'AbortError',reason:'request_cancelled'}),null);
 assert.equal(describe({reason:'request_timeout'}).kind,'network');assert.equal(describe({name:'TypeError'}).kind,'network');
 assert.equal(describe({code:'session_verify_timeout'}).kind,'network');assert.equal(describe({reason:'shell_session_unavailable'}).kind,'session');
});

test('mandatory password change uses dedicated wording and leaves verified identity current',async()=>{
 const error=Object.assign(new Error('mandatory_password_change_required'),{reason:'mandatory_password_change_required',status:403});
 const describe=require('../js/supabase-kpi-client.js').describeReadError;assert.equal(describe(error).kind,'password-change');assert.match(describe(error).body,/เปลี่ยนรหัสผ่าน/);
 const f=fixture(),pending=f.c.initSystem();await tick();f.requests[0].reject(error);await pending;
 assert.equal(f.run('sessionToken'),token);assert.equal(f.run('kpiVerifiedSession')!==null,true);assert.equal(f.node('kpi-startup-retry').hidden,true);assert.doesNotMatch(f.node('kpi-session-message').textContent,/เซสชันหมดอายุ/);
});

test('startup signed verification password-change rejection blocks domain reads and retries in both modes',async()=>{
 for(const embedded of [false,true]){
  let verifies=0,domainReads=0;const error=Object.assign(new Error('mandatory_password_change_required'),{reason:'mandatory_password_change_required',status:403});
  const f=identityRig({verify:async()=>{verifies++;throw error;}});f.window.AkraModule.embedded=embedded;f.window.AkraModule.getToken=()=>token;
  f.window.AkraSupabaseKPI=require('../js/supabase-kpi-client.js');f.c.CURRENT_VERSION='fixture';f.c.checkAppVersion=async()=>true;
  f.c.AppVersionGuard={start(){}};f.c.handleLineBrowserRedirect=()=>false;f.c.loadConfig=async()=>domainReads++;
  f.c.startStartupActivityPrefetch=()=>{domainReads++;};f.run(source('initSystem'));await f.c.initSystem();
  assert.equal(verifies,1);assert.equal(domainReads,0);assert.equal(f.run('sessionToken'),null);assert.equal(f.run('kpiVerifiedSession'),null);
  assert.equal(f.node('kpi-startup-retry').hidden,true);assert.match(f.node('kpi-session-message').textContent,/เปลี่ยนรหัสผ่าน/);
  assert.doesNotMatch(f.node('kpi-session-message').textContent,/เซสชันหมดอายุ/);assert.equal(f.local.has('akra_kpi_session'),false);
 }
});

test('transport retires only a 401 or invalid_or_expired_token, never a password-change or other 403 reason',async()=>{
 for(const action of ['getConfig','getKanbanLineDelivery'])for(const [status,reason,retired]of [[403,'mandatory_password_change_required',false],[403,'session_revoked',false],[403,'permission_denied',false],[401,'',true],[403,'invalid_or_expired_token',true]]){
  let rejected=0;const owner={token:'fixture'},window={getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>owner.token,onKpiSessionRejected:()=>rejected++};
  const c=vm.createContext({window,console,setTimeout,clearTimeout,AbortController,fetch:async()=>({ok:false,status,json:async()=>({status:'error',reason})})});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8'),c);
  await assert.rejects(c.AkraSupabaseKPI[action](owner.token,{branch:'AKRA',taskId:'20000000-0000-4000-8000-000000000001'}));assert.equal(rejected,retired?1:0,action+'/'+status+'/'+reason);
 }
});

test('postverify missing/invalid immutable identity returns to Main with zero domain reads or retry',async()=>{
 for(const embedded of [false,true])for(const identityId of [undefined,'invalid-identity']){
  const f=identityRig({verify:async()=>({...original,identityId})});f.window.AkraModule.embedded=embedded;f.window.AkraModule.getToken=()=>token;f.window.AkraSupabaseKPI=require('../js/supabase-kpi-client.js');
  let domainReads=0;f.c.CURRENT_VERSION='fixture';f.c.checkAppVersion=async()=>true;f.c.AppVersionGuard={start(){}};f.c.handleLineBrowserRedirect=()=>false;f.c.loadConfig=async()=>domainReads++;f.c.startStartupActivityPrefetch=()=>{domainReads++;};
  f.run(source('initSystem'));await f.c.initSystem();assert.equal(domainReads,0);assert.equal(f.run('sessionToken'),null);assert.equal(f.run('kpiVerifiedSession'),null);assert.equal(f.node('kpi-startup-retry').hidden,true);assert.deepEqual(f.redirects,[f.run('PORTAL_URL')]);
 }
});
test('initial Main verification failure stays blocked, keeps typed reason and retries fresh verification',async()=>{
 for(const error of [new TypeError('offline'),Object.assign(new Error('internal_error'),{reason:'internal_error',status:500}),Object.assign(new Error('permission_denied'),{reason:'permission_denied',status:403}),Object.assign(new Error('invalid_or_expired_token'),{reason:'invalid_or_expired_token',status:401})]){
  let calls=0;const f=identityRig({verify:async()=>{calls++;if(calls===1)throw error;return original;}});f.window.AkraSupabaseKPI=require('../js/supabase-kpi-client.js');
  f.window.history.replaceState=()=>{f.window.location.search='';};
  const failed=await f.c.resolveSsoAuth();assert.equal(failed.error,error);assert.equal(f.run('sessionToken'),null);assert.equal(f.run('kpiVerifiedSession'),null);
  f.c.showKpiVerificationFailure(error);assert.equal(f.node('kpi-startup-retry').hidden,error.status===401||error.status===403);
  if(!error.status||error.status===500){const retry=await f.c.resolveSsoAuth();assert.equal(calls,2);assert.ok(retry.userData);assert.equal(f.run('sessionToken'),token);}
 }
});
test('initial verification rejects replaced stored login and stale callback without an outage display',async()=>{
 let fail;const f=identityRig({verify:()=>new Promise((resolve,reject)=>fail=reject)});f.window.AkraSupabaseKPI=require('../js/supabase-kpi-client.js');
 const read=f.c.resolveSsoAuth();await tick();f.local.set('akra_kpi_session','replacement-login');fail(new TypeError('offline'));const result=await read;
 assert.equal(result.superseded,true);assert.equal(result.error,undefined);assert.equal(f.local.get('akra_kpi_session'),'replacement-login');
});
for(const surface of ['Kanban','Duty'])test(surface+' actual read controller displays classified retry and reaches successful empty',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll:()=>[]});return nodes.get(id);};
 let fail=true,calls=0;const describe=require('../js/supabase-kpi-client.js').describeReadError;
 const window={getKpiTaskContext:()=>({token:'fixture',branch:'AKRA',userUid:'u1',name:'Fixture',employees:[],can:()=>true}),AkraSupabaseKPI:{describeReadError:describe,getKanbanBoard:async()=>{calls++;if(fail)throw Object.assign(new Error('raw server detail'),{status:500});return{tasks:[],employees:[],incomingIssues:[]};},getDutyMatrix:async()=>{calls++;if(fail)throw new TypeError('offline');return{catalog:[],assignments:[],employees:[],capacities:[]};}}};
 const c=vm.createContext({window,document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){},body:{style:{}}},console,Intl,Date,Math,structuredClone,crypto:require('node:crypto').webcrypto});
 vm.runInContext(fs.readFileSync(path.join(__dirname,surface==='Kanban'?'../js/kpi-kanban-board.js':'../js/kpi-duty-matrix.js'),'utf8'),c);
 const controller=surface==='Kanban'?window.KpiKanbanBoard:window.KpiDutyMatrix,read=surface==='Kanban'?'loadKanbanBoard':'loadDutyMatrix',id=surface==='Kanban'?'kb-board-content':'kb-duty-content';
 await controller[read]();assert.match(node(id).innerHTML,surface==='Kanban'?/ระบบขัดข้องชั่วคราว/:/เชื่อมต่อไม่ได้/);assert.match(node(id).innerHTML,/ลองอีกครั้ง/);assert.doesNotMatch(node(id).innerHTML,/raw server detail|offline/);
 fail=false;await controller[read]();assert.equal(calls,2);assert.doesNotMatch(node(id).innerHTML,/ระบบขัดข้องชั่วคราว|เชื่อมต่อไม่ได้/);
});
test('actual standalone verifier has server retry for reasonless 500 and respects explicit session reasons',async()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'../js/akra-shell-bridge.js'),'utf8');const start=bridge.indexOf('        verifySession: async ('),end=bridge.indexOf('\n        home:',start);
 const verifier=bridge.slice(start,end).trim().replace(/^verifySession:\s*/,'').replace(/,$/,'');assert.ok(start>=0&&end>start);
 const describe=require('../js/supabase-kpi-client.js').describeReadError;
 for(const [status,payload,kind]of [[500,{},'server'],[500,{reason:'invalid_or_expired_token'},'session'],[403,{},'permission'],[401,{},'session'],[200,{valid:false},'session']]){
  const c=vm.createContext({window:{},shell:null,isMainSignedOut:()=>false,SESSION_VERIFY_TIMEOUT_MS:10000,sessionStamp:()=>'',AbortController,setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:status===200,status,json:async()=>payload})});
  vm.runInContext('globalThis.verify='+verifier,c);
  await assert.rejects(c.verify('app-kpi','fixture-token'),error=>describe(error).kind===kind);
 }
});
test('late HTTP401 and rejected transport401 cannot call retirement for a replacement client owner',async()=>{
 const adapter=fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8');
 for(const action of ['getConfig','getKanbanLineDelivery'])for(const rejected of [false,true]){
  let owner={},finish,reject,retirements=0;const window={getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>'fixture-token',onKpiSessionRejected:()=>retirements++};
  const c=vm.createContext({window,self:window,AbortController,setTimeout,clearTimeout,fetch:()=>new Promise((resolve,no)=>{finish=resolve;reject=no;})});vm.runInContext(adapter,c);
  const read=window.AkraSupabaseKPI[action]('fixture-token',{branch:'AKRA',taskId:'20000000-0000-4000-8000-000000000001'});owner={};
  if(rejected)reject(Object.assign(new Error('invalid_or_expired_token'),{reason:'invalid_or_expired_token',status:401}));else finish({ok:false,status:401,json:async()=>({reason:'invalid_or_expired_token'})});
  await assert.rejects(read,error=>error.reason==='session_changed');assert.equal(retirements,0);
 }
});
