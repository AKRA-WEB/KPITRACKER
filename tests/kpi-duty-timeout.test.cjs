const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8');
function fixture(fetch){
  const timers=[],owner={token:'fixture'},module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,AbortController,fetch,window:{getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>'fixture'},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
  return {client:module.exports,timers};
}
for(const action of ['getDutyMatrix','setDutyAssignment'])for(const stalledBody of [false,true]) test(action+' bounds stalled '+(stalledBody?'response body':'fetch'),async()=>{
  let signal,finishBody;
  const f=fixture(async(url,options)=>{signal=options.signal;return stalledBody?{ok:true,json:()=>new Promise(resolve=>{finishBody=resolve;})}:new Promise(()=>{});});
  const pending=f.client[action]('fixture',action==='getDutyMatrix'?'AKRA':{branch:'AKRA',employeeUid:'u1',dutyId:'inbound',targetType:'primary',expectedRevision:0});
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.timers.length,1,'duty requests have a deadline');
  f.timers[0]();
  await assert.rejects(pending,err=>err.reason==='request_timeout');assert.equal(signal.aborted,true);
  finishBody?.({status:'success',catalog:[],assignments:[]});
});
