const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const pw=[path.resolve(__dirname,'../../SOP/node_modules/playwright'),path.resolve(__dirname,'../../../../SOP/node_modules/playwright')].find(p=>fs.existsSync(p));
const {chromium}=require(pw || 'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://local').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage(); const calls=[],errors=[];let rows=[],actions=[],conflict=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=route.request().url(); if(url.startsWith('http://127.0.0.1:'))return route.continue();
  if(url.endsWith('/functions/v1/kpi-api')) {
   const p=route.request().postDataJSON();calls.push(p);let data={status:'success',records:[],nextCursor:null};
   if(p.action==='getDailyData')data.records=rows;
   if(p.action==='getActions')data.actions=actions;
   if(p.action==='saveWorkload')data.workload=[{...p.workload,employeeUid:p.employeeUid}];
   if(p.action==='clearWorkload')data.workload=[];
   if(p.action==='saveSection') {
    if(conflict)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({status:'error',reason:'record_conflict'})});
    const record={date:p.date,branch:p.branch,volume:p.volume,customerNotes:p.customerNotes,sectionRevisions:{[p.section]:p.expectedRevision+1}};rows=[record];data.record=record;
   }
   if(p.action==='saveAction'){data.actionItem={...p.actionItem,revision:p.expectedRevision+1};actions=[data.actionItem];}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.includes('script.google.com')) {const body=route.request().postData()||''; assert.ok(!url.includes('action=getData')&&!url.includes('action=getActions')&&!body.includes('saveSection')&&!body.includes('saveAction'),'no Step 3 GAS calls');}
  return route.abort();
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/?mock=1`);
 await page.waitForFunction(()=>document.getElementById('system-loading').classList.contains('hidden'));
 await page.evaluate(()=>{
  sessionToken='test';currentUser='a';currentRoles=['AKRA'];currentBranch='AKRA';USER_DB={};
  document.getElementById('record-date').value='2026-09-08';_lastRecordDate='2026-09-08';_draftTimer=null;
  safeStorage.setItem('kpiData_AKRA',JSON.stringify([{date:'2026-09-08',volume:{transfer:1,pickup:0,upcountry:0,inmarket:0,outmarket:0},sectionRevisions:{operations:1}}]));
  hydrateSelectedDayRecord('2026-09-08');
 });
 await page.evaluate(()=>refreshActions());assert.ok(calls.some(p=>p.action==='getActions'&&p.branch==='AKRA'),'viewer absent from employee map can read Actions');
 // Concurrent refresh must not replace the edit revision while draft values remain.
 await page.evaluate(()=>{
  document.getElementById('vol-transfer').value='7';saveMainRecordDraft('2026-09-08');
  mergeDailySectionsIntoCache('AKRA',[{date:'2026-09-08',volume:{transfer:99},sectionRevisions:{operations:2}}]);
  hydrateSelectedDayRecord('2026-09-08');
 });
 conflict=true;await page.evaluate(()=>saveOperationsCard());assert.equal(calls.filter(p=>p.action==='saveSection').at(-1).expectedRevision,1);
 assert.equal(await page.locator('#vol-transfer').inputValue(),'7','conflict retains draft');conflict=false;
 await page.evaluate(()=>{
  safeStorage.removeItem('kpiDraft_a_AKRA_2026-09-08_main');_draftTimer=null;hydrateSelectedDayRecord('2026-09-08');
  document.getElementById('vol-transfer').value='8';
 });
 await page.evaluate(()=>saveOperationsCard());assert.equal(calls.filter(p=>p.action==='saveSection').at(-1).expectedRevision,2);
 // Canonical empty weekly plan suppresses stale non-Monday cache rows.
 await page.evaluate(()=>{
  safeStorage.removeItem('kpiDraft_a_AKRA_2026-09-08_main');safeStorage.removeItem(draftKey());
  safeStorage.setItem('kpiData_AKRA',JSON.stringify([{date:'2026-09-07',tasks:[],sectionRevisions:{tasks:2}},{date:'2026-09-08',tasks:[{taskName:'deleted',status:'ยังไม่เริ่ม',assignee:'A'}]}]));
  loadTasksForSelectedDate();
 });
 assert.ok(!(await page.locator('.task-name').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('deleted'));
 // Action form retains original revision after background refresh and saves directly.
 await page.evaluate(()=>{
  const act={actionId:'ACT-test',branch:'AKRA',sourceDate:'2026-09-08',title:'old',detail:'',category:'อื่นๆ',severity:'Low',owner:'A',dueDate:'2026-09-10',status:'Open',resolutionNote:'',revision:1};
  ALL_ACTIONS=[act];localActionsDraft=[];openActionModalForEdit('ACT-test');ALL_ACTIONS=[{...act,title:'other editor',revision:2}];
  safeStorage.setItem('kpiDraft_a_AKRA_2026-09-08_main',JSON.stringify({actions:[act]}));
 });
 await page.locator('#action-form-title').fill('my edit');
 await page.evaluate(()=>handleActionFormSubmit({preventDefault(){}}));
 assert.equal(calls.filter(p=>p.action==='saveAction').at(-1).expectedRevision,1);
 assert.equal(await page.evaluate(()=>JSON.parse(safeStorage.getItem('kpiDraft_a_AKRA_2026-09-08_main')).actions[0].revision),2);
 assert.equal(await page.evaluate(()=>JSON.parse(safeStorage.getItem('kpiDraft_a_AKRA_2026-09-08_main')).actions[0].title),'my edit');
 assert.equal(errors.length,0,errors.join('\n'));
 await page.evaluate(async()=>{
  currentUser='UID-123';displayUserName='Same display name';currentBranch='AKRA';sessionToken='test';
  syncDataFromSheet=async()=>{};loadDashboardData=()=>{};updateDailyDashboard=()=>{};
  AppVersionGuard.blockIfStale=async()=>false;window.confirm=()=>true;
  const date=getTodayBangkokDateStr();document.getElementById('record-date').value=date;
  await executeSaveWorkload(getAkraWorkloadValues(),date);
  await clearWorkloadCard();
  QUICK_WORKLOAD_STATE={totalHours:10,primaryHours:10,primaryCore:'คลัง W1',hasSupport:false,supportHours:0};
  await submitQuickWorkload();
 });
 const wlCalls=calls.filter(p=>['saveWorkload','clearWorkload'].includes(p.action));
 assert.deepEqual(wlCalls.map(p=>[p.action,p.employeeUid]),[['saveWorkload','UID-123'],['clearWorkload','UID-123'],['saveWorkload','UID-123']]);
 assert.ok(wlCalls.every(p=>/^\d{4}-\d\d-\d\d$/.test(p.date)));
 assert.equal(wlCalls[2].workload.employee,'Same display name');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS browser: real form CAS/draft retention, direct Action save, viewer branch scope and canonical weekly deletion');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
