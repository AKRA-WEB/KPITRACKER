const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function activity() {
  const elements=new Map(['record-date','dash-activity-summary','profile-activity-summary'].map(id=>[id,{value:'2026-10-02',textContent:''}]));
  const c={document:{getElementById:id=>elements.get(id)},liveRequisitionsList:[],liveOperationalEventsList:[],liveRequisitionsLoadedDate:''};
  c.window=c;c.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',userUid:'chen'});
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/kpi-integration.js'),'utf8'),c);
  return {c,elements};
}
test('daily activities keep actual UID attribution and eligible LINE assignment separate',()=>{
  const {c}=activity();const sum=c.KpiIntegration.summarize([
    {workloadEligible:true,assigneeIdentityStatus:'linked',assigneeEmployeeUid:'CHEN'},
    {workloadEligible:true,assigneeIdentityStatus:'unlinked',assigneeEmployeeUid:'chen'},
    {workloadEligible:false,assigneeIdentityStatus:'linked',assigneeEmployeeUid:'chen'}
  ],[{actorEmployeeUid:' chen '},{actorName:'chen'},{actorEmployeeUid:'someone',actorName:'chen'}],'CHEN');
  assert.deepEqual(JSON.parse(JSON.stringify(sum)),{total:5,requests:2,actual:3,myActual:1,myAssigned:1});
  assert.equal(c.KpiIntegration.summarize([], [{actorEmployeeUid:''}], '').myActual,0);
});
test('empty day displays zero, failures stay visible and a successful Workload read recovers',async()=>{
  const {c,elements}=activity();c.fetchLiveRequisitions=async()=>{c.liveRequisitionsLoadedDate='2026-10-02';return true;};
  await c.KpiIntegration.refreshActivity();assert.match(elements.get('dash-activity-summary').textContent,/0 กิจกรรม/);
  c.fetchLiveRequisitions=async()=>false;await c.KpiIntegration.refreshActivity();assert.match(elements.get('profile-activity-summary').textContent,/ไม่สำเร็จ/);
  c.KpiIntegration.acceptActivity();assert.match(elements.get('profile-activity-summary').textContent,/ปฏิบัติงานจริง 0/);
});
test('late activity responses cannot update a changed date or session',async()=>{
  const {c,elements}=activity();let finish;c.fetchLiveRequisitions=()=>new Promise(resolve=>finish=resolve);
  const p=c.KpiIntegration.refreshActivity();elements.get('record-date').value='2026-10-03';elements.get('dash-activity-summary').textContent='new date';finish(true);await p;
  assert.equal(elements.get('dash-activity-summary').textContent,'new date');
  const next=c.KpiIntegration.refreshActivity();c.getKpiTaskContext=()=>({token:'changed',branch:'TRD',userUid:'other'});elements.get('profile-activity-summary').textContent='new session';finish(false);await next;
  assert.equal(elements.get('profile-activity-summary').textContent,'new session');
});
test('Dashboard canonical task routing and forced refresh reject stale reads',async()=>{
  const c={console,document:{addEventListener(){},querySelectorAll(){return[];},getElementById(){return {addEventListener(){}};}},addEventListener(){},setTimeout,clearTimeout,URL,URLSearchParams,location:{search:'',hostname:'localhost'},navigator:{},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null;}},alert(){}};c.window=c;vm.createContext(c);
  for(const [,src] of fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(src.trim())new vm.Script(src).runInContext(c);
  let routed;c.KpiKanbanBoard={openFromDashboard:(...args)=>routed=args};c.openActionModalForEdit=id=>routed=[id,'legacy'];
  c.openDashboardTask('task','TRD',true);assert.deepEqual(routed,['task','TRD']);c.openDashboardTask('old','AKRA',false);assert.deepEqual(routed,['old','legacy']);
  c.document.getElementById=()=>null;
  vm.runInContext("sessionToken='fixture';currentBranch='AKRA';currentRoles=['AKRA'];ALL_ACTIONS=[];updateDailyDashboard=()=>{};renderExecutiveActionCenter=()=>{};loadRecordActionsForSelectedDate=()=>{};",c);
  const reads=[];c.AkraSupabaseKPI={getActions:()=>new Promise(resolve=>reads.push(resolve))};
  const first=c.refreshActions(true),second=c.refreshActions(true);
  reads[1]([{actionId:'fresh'}]);await second;reads[0]([{actionId:'stale'}]);await first;
  assert.equal(vm.runInContext('ALL_ACTIONS[0].actionId',c),'fresh');
  const third=c.onKpiTaskChanged();assert.equal(reads.length,3);reads[2]([{actionId:'saved'}]);await third;
  assert.equal(vm.runInContext('ALL_ACTIONS[0].actionId',c),'saved');
  const fourth=c.refreshActions(true);vm.runInContext("sessionToken='new-session';currentBranch='TRD';",c);reads[3]([{actionId:'wrong-session'}]);await fourth;
  assert.equal(vm.runInContext('ALL_ACTIONS[0].actionId',c),'saved');
});
