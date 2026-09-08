const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const values = new Map();
const context = { console, getIncidentCategoryLabel: () => "", currentBranch: 'TRD', recordedErrorCases: [], document: {getElementById: () => ({value:'2026-09-08'})},
 safeStorage: {getItem: k => values.get(k)}, normalizeClientDateKey: d => d,
 KPI_SYSTEM_CONFIG: {incidentModel: {branches: {TRD: {impacts: [{id:'custom',label:'กระทบการผลิต'}]}}}} };
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/incident-impact.js'),'utf8'),context);
const api=context.KpiIncident;
for(const [date,start,end] of [['2026-09-07','2026-09-07','2026-09-13'],['2026-09-13','2026-09-07','2026-09-13'],['2027-01-01','2026-12-28','2027-01-03'],['2026-03-01','2026-02-23','2026-03-01']]){
 assert.deepEqual(JSON.parse(JSON.stringify(api.weekRange(date))),{start,end});
}
values.set('kpiData_TRD', JSON.stringify(['2026-09-06','2026-09-07','2026-09-10','2026-09-13','2026-09-14'].map(date=>({date,branch:'TRD',incidentCases:[{caseId:'ERR-'+date+'-a',type:'เคส'}]}))));
assert.deepEqual(Array.from(api.weekCases(),r=>r.recordDate),['2026-09-13','2026-09-10','2026-09-07']);
context.currentBranch='AKRA';assert.equal(api.weekCases().length,0);context.currentBranch='TRD';
assert.equal(api.impactLabel('custom'),'กระทบการผลิต');
assert.equal(api.impactLabel({impact:'custom',impactLabel:'ชื่อเดิม'}),'ชื่อเดิม');
const row={schemaVersion:3,scoringMode:'none',impact:'custom',impactLabel:'ชื่อเดิม',caseId:'id'};
assert.equal(api.summarize([row,row]).impact.custom,1);
assert.equal(api.impactLabel(''),'ไม่มีผลกระทบ');
assert.equal(api.impactLabel({impact:''}),'ไม่มีผลกระทบ');
assert.equal(api.impactLabel({impact:'',impactLabel:'ไม่มีผลกระทบ'}),'ไม่มีผลกระทบ');
const rowEmpty={schemaVersion:3,scoringMode:'none',impact:'',caseId:'id-empty'};
assert.equal(api.detail(rowEmpty,'TRD').impactLabel,'ไม่มีผลกระทบ');
assert.equal(api.detail(rowEmpty,'TRD').isReachedCustomer,false);
assert.equal(api.detail(rowEmpty,'TRD').isFixedBefore,false);
assert.equal(api.summarize([rowEmpty]).total,1);
console.log('PASS: actual week boundaries, branch isolation, original dates, custom impact counts and snapshot labels.');
