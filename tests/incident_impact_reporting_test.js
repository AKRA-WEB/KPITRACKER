const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
const context={console,window:{addEventListener(){}},document:{addEventListener(){},querySelectorAll(){return []},getElementById(){return {addEventListener(){}}}},setTimeout,clearTimeout,URL,URLSearchParams,
 location:{search:'',hostname:'localhost'},localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null}},navigator:{},alert(){}};
context.window=context;context.addEventListener=()=>{};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js/incident-impact.js'),'utf8'),context);
scripts.filter(s=>s.trim()).forEach(s=>new vm.Script(s).runInContext(context));
const event={schemaVersion:3,scoringMode:'none',kind:'case',caseId:'ERR-2026-09-08-a',typeId:'picking',type:'จัดสินค้าผิด',category:'W1',impact:'reached_customer',penalty:0,participants:['A','B']};
context.rows=[{...event,emp:'A'},{...event,emp:'B'}, {...event,caseId:'ERR-2026-09-08-b',impact:'contained'},
 {kind:'case',caseId:'positive',type:'ผลงาน: ช่วยงาน',category:'team_support',responsibility:'process',penalty:0,worker:'A'}];
const result=vm.runInContext("buildParetoAnalysis([{date:'2026-09-08',sourceBranch:'TRD',errors:rows}], 'ALL','ALL',100)",context);
assert.equal(result.total,2);assert.equal(result.rows[0].reached,1);assert.equal(result.rows[0].fixed,1);
assert.equal(result.events[0].schemaVersion,3);
const daily=vm.runInContext("buildDailyDashboardErrorState(rows,'TRD')",context);
assert.equal(daily.cases.length,2);assert.equal(Object.keys(daily.dailyHpImpact).length,0);
const metrics=context.KpiIncident.summarize(context.rows);assert.equal(metrics.total,2);assert.equal(metrics.impact.reached_customer,1);
console.log('PASS: actual mixed-model Pareto, daily and case metrics deduplicate participants and exclude achievements.');
