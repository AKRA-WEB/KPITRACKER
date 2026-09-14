const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(process.env.KPI_SOURCE || path.join(__dirname, '../index.html'), 'utf8');
const start=html.indexOf('        const ScopedRefresher = {');
const end=html.indexOf("        window.addEventListener('focus'",start);
assert.ok(start>=0 && end>start);
const calls=[], writes=[], rendered=[];
const storage=new Map();
const api={};
for(const [method,kind] of [['getIncidentData','incident'],['getWorkloadData','workload'],['fetchBranchData','daily']]){
 api[method]=(token,branch,months)=>new Promise((resolve,reject)=>calls.push({kind,token,branch,months,resolve,reject}));
}
const context={sessionToken:'session-a',currentBranch:'AKRA',window:{AkraSupabaseKPI:api},AkraSupabaseKPI:api,
 safeStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>{storage.set(key,value);writes.push({key,value});}},
 mergeAuthoritativeIncidentData:(_data,records)=>records,mergeAuthoritativeWorkloadData:(_data,records)=>records,
 mergeDailySectionsIntoCache:(branch,records)=>writes.push({key:'daily:'+branch,value:records}),
 document:{getElementById:()=>({value:'2026-09-14'})},hydrateIncidentPreview:()=>rendered.push('incident:'+context.currentBranch),
 renderTeamWorkloadPreview:()=>rendered.push('workload:'+context.currentBranch),updateDailyDashboard:()=>{},console:{error:()=>{}}};
vm.createContext(context);vm.runInContext(html.slice(start,end)+'\nglobalThis.refresher=ScopedRefresher;',context);
const r=context.refresher;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=call=>call.resolve({records:[{marker:call.token+':'+call.branch}]});
(async()=>{
 const first=r.trigger('AKRA'), second=r.trigger('AKRA');await tick();
 assert.equal(calls.length,2,'overlapping reads must issue one request per kind');
 calls.forEach(settle);await Promise.all([first,second]);
 assert.equal(Object.keys(r.inFlight.AKRA).length,0,'settled requests released');
 console.log('PASS concurrent refresh: 2 triggers -> 2 requests (baseline 4)');
 const old=r.trigger('AKRA');await tick();const oldCalls=calls.slice(-2);
 context.sessionToken='session-b';context.currentBranch='TRD';
 const fresh=r.trigger('TRD');await tick();settle(calls.at(-1));await fresh;
 const before=writes.length;oldCalls.forEach(settle);await old;
 assert.equal(writes.length,before,'old session results must not write caches');
 assert.ok(rendered.at(-1)==='incident:TRD');
 const changed=r.trigger('AKRA');await tick();const changedCalls=calls.slice(-2);
 context.currentBranch='TRD';const renderCount=rendered.length;changedCalls.forEach(settle);await changed;
 assert.equal(rendered.length,renderCount,'background branch cannot redraw current branch');
 console.log('PASS session isolation and branch UI isolation');
 const retry1=r.trigger('AKRA');await tick();calls.slice(-2).forEach(call=>call.reject(new Error('fixture failure')));await retry1;
 const n=calls.length;const retry2=r.trigger('AKRA');await tick();assert.equal(calls.length,n+2);calls.slice(-2).forEach(settle);await retry2;
 console.log('PASS retry after error');
 const daily1=r.refreshDaily('AKRA',3),daily2=r.refreshDaily('AKRA',3);await tick();
 assert.equal(daily1,daily2);const stale=calls.at(-1);
 r.invalidate('AKRA');const daily3=r.refreshDaily('AKRA',3);await tick();const latest=calls.at(-1);
 latest.resolve([{marker:'after mutation'}]);await daily3;const mutationWrites=writes.length;
 stale.resolve([{marker:'before mutation'}]);await daily1;assert.equal(writes.length,mutationWrites);
 assert.equal(writes.at(-1).value[0].marker,'after mutation');
 const range1=r.refreshDaily('AKRA',3),range2=r.refreshDaily('AKRA',null);await tick();
 assert.deepEqual(calls.slice(-2).map(c=>c.months),[3,null]);calls.slice(-2).forEach(c=>c.resolve([]));await Promise.all([range1,range2]);
 console.log('PASS daily dedup, history range separation and post-mutation freshness');
 const syncStart=html.indexOf('        let dailySyncRun = null;');
 const syncEnd=html.indexOf('        // ================= DASHBOARD LOGIC',syncStart);
 const branchStart=html.indexOf('        async function fetchBranchData(branch, monthsQuery)');
 const branchEnd=html.indexOf('        async function syncAllBranchesForAdmin()',branchStart);
 assert.ok(syncStart>=0&&syncEnd>syncStart&&branchStart>=0&&branchEnd>branchStart);
 Object.assign(context,{_dailyDataLoading:false,_dailyDataLoadError:'',_adminFullLoaded:false,
 loadTasksForSelectedDate(){},hydrateSelectedDayRecord(){},loadDashboardData(){},renderAdminDashboard(){},showToast(){}});
 context.document.getElementById=()=>({value:'2026-09-14',classList:{contains:()=>true}});
 vm.runInContext(html.slice(syncStart,syncEnd)+html.slice(branchStart,branchEnd),context);
 context.currentBranch='AKRA';const initial=calls.length;
 const admin=context.fetchBranchData('AKRA','&months=3');
 const selected=context.syncDataFromSheet(false);await tick();
 assert.equal(calls.length-initial,3,'admin and selected startup share all three reads');
 for(const call of calls.slice(initial))call.resolve(call.kind==='daily'?[]:{records:[]});
 await Promise.all([admin,selected]);assert.equal(context._dailyDataLoading,false);
 console.log('PASS admin/selected startup -> 3 shared requests, loading clears');
 context.sessionToken='';const previous=calls.length;await r.trigger('AKRA');await r.refreshDaily('AKRA');assert.equal(calls.length,previous);
 console.log('PASS missing session issues zero API requests');
})().catch(error=>{console.error(error);process.exitCode=1;});
