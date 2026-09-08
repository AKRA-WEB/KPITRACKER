const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const playwrightPath = [path.resolve(__dirname, '../../SOP/node_modules/playwright'), path.resolve(__dirname, '../../../../SOP/node_modules/playwright'), path.resolve(__dirname, '../../../../../../SOP/node_modules/playwright')].find(p => fs.existsSync(p)) || 'playwright';
const {chromium}=require(playwrightPath);
const root=path.resolve(__dirname,'..'),model=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/incident-model.json'),'utf8'));model.active=true;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript':'application/json');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[],reads=[],errors=[],records={AKRA:[],TRD:[]};let failNext=false,holdNext=false,release;
 await page.clock.install({time:new Date('2026-09-08T04:00:00Z')});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request();if(req.url().startsWith('http://127.0.0.1:'))return route.continue();
 if(['cdn.tailwindcss.com','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(req.url()).hostname))return route.continue();
 if(req.url().endsWith('/kpi-api')){
  const p=req.postDataJSON();reads.push(p);const result=(date=p.date)=>{const rows=records[p.branch].filter(r=>!date || r.caseId.startsWith(`ERR-${date}-`));return {status:'success',incidents:rows,errors:rows.flatMap(r=>r.participants.map(emp=>({...r,emp,displayNote:r.note}))),zeroConfirmed:false};};
  if(['saveIncident','updateIncident'].includes(p.action)){
   writes.push(p);if(holdNext){holdNext=false;await new Promise(r=>release=r);}
   const t=model.branches[p.branch].types.find(t=>t.id===p.incident.typeId),old=records[p.branch].find(r=>r.caseId===p.incident.caseId);
   const saved={...p.incident,type:t.name,impactLabel:model.branches[p.branch].impacts?.find(i=>i.id===p.incident.impact)?.label,penalty:0,revision:p.action==='updateIncident'?(old.revision||0)+1:1};
   records[p.branch]=[...records[p.branch].filter(r=>r.caseId!==saved.caseId),saved];
   if(failNext){failNext=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({status:'error',reason:'temporary_failure'})});}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result())});
  }
  if(p.action==='deleteIncident'){writes.push(p);records[p.branch]=records[p.branch].filter(r=>r.caseId!==p.caseId);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result())});}
  if(p.action==='getIncidentData')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',records:[...new Set(records[p.branch].map(r=>r.caseId.slice(4,14)))].map(date=>({date,...result(date)}))})});
  if(p.action==='getIncidentHistory')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',revisions:[{revision:1,actor:'a',action:'create',created_at:'2026-09-08',after_entries:[records[p.branch][0]],reason:''}]})});
  if(p.action==='saveIncidentCatalog'){Object.assign(model,p.configValue,{catalogRevision:p.configValue.catalogRevision+1});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',configValue:model})});}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',records:[],revisions:[]})});}
 return route.abort();});
 await page.goto(`http://127.0.0.1:${server.address().port}/?mock=1`);await page.waitForFunction(()=>document.getElementById('system-loading').classList.contains('hidden'));
 await page.evaluate(m=>{KPI_SYSTEM_CONFIG={incidentModel:m};sessionToken='test';currentUser='a';currentRoles=['ADMIN'];getBranchActiveRoster=()=>['A'];selectedErrWorker='A';
  window.originalLoadDashboardData=loadDashboardData;loadDashboardData=()=>{};updateDailyDashboard=()=>{};document.getElementById('app-content').classList.remove('hidden');document.getElementById('custom-modal').classList.add('hidden');
  document.querySelectorAll('.app-record-date').forEach(e=>e.value='2026-09-08');switchTab('error');},model);
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('custom-modal')).display==='none');
 for(const branch of ['TRD','AKRA']){
  await page.evaluate(b=>{currentBranch=b;renderErrSeverity();},branch);
  const picking=model.branches[branch].types.find(t=>t.name==='จัดสินค้าผิด');
  await page.locator(`[data-type-id="${picking.id}"]`).click();
  await page.locator('#btn-save-error-preview').click();assert.equal(writes.filter(w=>w.branch===branch).length,0,'missing impact blocks save');
  await page.locator('[data-impact="reached_customer"]').click();await page.locator('#pc-err-note-input').fill('customer incident');
  await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);
  const sent=writes.at(-1);assert.equal(sent.incident.typeId,picking.id);assert.equal(sent.incident.impact,'reached_customer');assert.equal(sent.incident.penalty,undefined);
  assert.match(await page.locator('#inc-success-summary').innerText(),/ถึงลูกค้า/);assert.doesNotMatch(await page.locator('#inc-form-body').innerText(),/HP/);
  await page.locator('#btn-inc-next-case').click();await page.locator('#inc-quick-search').fill('จัดสินค้าผิด');await page.locator(`[data-type-id="${picking.id}"]`).click();await page.locator('[data-impact="contained"]').click();
  await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);assert.equal(writes.at(-1).incident.impact,'contained');
 }
 // All original suspect categories and every explicit impact, including no-delivery types.
 for(const branch of ['TRD','AKRA']){
  await page.evaluate(b=>{currentBranch=b;KpiIncident.render();},branch);
  const t=model.branches[branch].types.find(t=>branch==='TRD'?t.name.includes('เช็คเกอร์'):t.name.includes('W2 ขาด'));
  for(const impact of t.impacts){await page.locator('#inc-quick-search').fill(t.name);await page.locator(`[data-type-id="${t.id}"]`).click();await page.locator(`[data-impact="${impact}"]`).click();await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);assert.equal(writes.at(-1).incident.impact,impact);assert.equal(writes.at(-1).incident.typeId,t.id);}
 }
 const shared=model.branches.AKRA.types.find(t=>t.category==='shared');
 await page.locator('#inc-quick-search').fill(shared.name);await page.locator(`[data-type-id="${shared.id}"]`).click();await page.locator('[data-impact="not_applicable"]').click();
 failNext=true;await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);const failedId=writes.at(-1).incident.caseId;
 await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);assert.equal(writes.at(-1).incident.caseId,failedId,'uncertain retry retains case ID');
 await page.evaluate(()=>{const r=recordedErrorCases.at(-1);r.worker='ทุกคนในกะ';r.participants=['A'];getBranchActiveRoster=()=>['A','B'];KpiIncident.edit(r.caseId);});
 await page.locator('#pc-err-note-input').fill('corrected note');await page.locator('#impact-reason').fill('note correction');
 await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);assert.equal(writes.at(-1).action,'updateIncident');assert.deepEqual(writes.at(-1).incident.participants,['A'],'editing preserves participants after roster change');
 await page.evaluate(()=>{const r=recordedErrorCases.at(-1);r.worker='A';r.participants=['A'];getBranchActiveRoster=()=>['B'];KpiIncident.edit(r.caseId);});
 assert.equal(await page.evaluate(()=>selectedErrWorker),'A','edited individual is not replaced by full shift');
 await page.locator('#impact-reason').fill('retain original person');await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);assert.deepEqual(writes.at(-1).incident.participants,['A']);assert.equal(writes.at(-1).incident.worker,'A');
 await page.evaluate(()=>{getBranchActiveRoster=()=>['A','B'];});
 await page.evaluate(()=>KpiIncident.history());await page.locator('#impact-dialog-body').getByText(/ครั้งที่ 1/).waitFor();await page.locator('#impact-dialog button').last().click();
 const toCancel=records.AKRA.at(-1).caseId;await page.evaluate(id=>KpiIncident.cancel(id),toCancel);await page.locator('#impact-cancel-reason').fill('entered in error');await page.locator('#impact-cancel-submit').click();await page.waitForFunction(()=>!document.getElementById('impact-dialog').open);assert.equal(records.AKRA.some(r=>r.caseId===toCancel),false);
 // A delayed response keeps the submitted scope and blocks branch/date changes.
 await page.locator('#inc-quick-search').fill(shared.name);await page.locator(`[data-type-id="${shared.id}"]`).click();await page.locator('[data-impact="unknown"]').click();holdNext=true;
 await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>KpiIncident.state.busy);assert.equal(await page.locator('#record-date-error').isDisabled(),true);
 await page.evaluate(()=>selectBranch('TRD'));assert.equal(await page.evaluate(()=>currentBranch),'AKRA');release();await page.waitForFunction(()=>!KpiIncident.state.busy);
 assert.match(await page.locator('#inc-success-summary').innerText(),/AKRA/);
 // Read saved records back through the client and restore the actual timeline after clearing memory.
 await page.evaluate(async()=>{recordedErrorCases=[];const r=await AkraSupabaseKPI.getIncidentData(sessionToken,'AKRA',3);recordedErrorCases=r.records[0].incidents;KpiIncident.timeline();});assert.match(await page.locator('#pc-err-timeline').innerText(),/ยังไม่ทราบ/);
 // Historical cases expose real Edit/Delete controls to ordinary branch users, including scored legacy cases.
 for(const branch of ['AKRA','TRD']){
  const t=model.branches[branch].types.find(t=>t.name==='จัดสินค้าผิด');
  const legacy={kind:'case',caseId:`ERR-2026-09-07-history-${branch}`,worker:'A',participants:['A'],responsibility:'individual',detectedBy:'Former detector',type:t.legacyNames[0],category:t.category,penalty:20,time:'11:00 น.',note:'past entry',revision:0};
  records[branch].push(legacy);
  await page.evaluate(({branch,legacy})=>{currentBranch=branch;currentRoles=[branch];applyIncidentSaveResultToCache('2026-09-07',branch,{incidents:[legacy],errors:[legacy]});document.getElementById('record-date-error').value='2026-09-08';hydrateIncidentPreview('2026-09-08');KpiIncident.render();KpiIncident.timeline();},{branch,legacy});
  await page.locator(`#pc-err-timeline button[onclick="KpiIncident.history('${legacy.caseId}')"]`).click();await page.locator('#impact-dialog-body').getByText(/ครั้งที่ 1/).waitFor();
  assert.equal(reads.at(-1).date,'2026-09-07','weekly history uses original date');await page.locator('#impact-dialog button').last().click();
  await page.locator(`#pc-err-timeline button[onclick="KpiIncident.edit('${legacy.caseId}')"]`).click();
  assert.equal(await page.locator('#impact-detector').inputValue(),'Former detector','historical detector remains selectable');
  assert.equal(await page.evaluate(()=>KpiIncident.state.impact),'','legacy correction requires explicit impact');
  const before=writes.length;await page.locator('#impact-reason').fill('แก้ไขย้อนหลัง');await page.locator('#btn-save-error-preview').click();assert.equal(writes.length,before);
  await page.locator('[data-impact="reached_customer"]').click();await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);
  assert.equal(writes.at(-1).action,'updateIncident');assert.equal(writes.at(-1).date,'2026-09-07');assert.equal(writes.at(-1).incident.caseId,legacy.caseId);assert.equal(writes.at(-1).incident.detectedBy,'Former detector');
  await page.evaluate(()=>{syncAppRecordDate('2026-09-08');KpiIncident.timeline();});
  await page.locator(`#pc-err-timeline button[onclick="KpiIncident.cancel('${legacy.caseId}')"]`).click();await page.locator('#impact-cancel-reason').fill('ลบรายการย้อนหลังที่บันทึกผิด');await page.locator('#impact-cancel-submit').click();await page.waitForFunction(()=>!document.getElementById('impact-dialog').open);
  assert.equal(writes.at(-1).date,'2026-09-07');assert.equal(records[branch].some(r=>r.caseId===legacy.caseId),false);
  assert.equal(await page.locator(`#pc-err-timeline button[onclick="KpiIncident.cancel('${legacy.caseId}')"]`).count(),0,'deleted past case disappears with another date selected');
 }
 await page.evaluate(rows=>{currentBranch='AKRA';currentRoles=['ADMIN'];document.getElementById('record-date-error').value='2026-09-08';recordedErrorCases=rows;KpiIncident.render();KpiIncident.timeline();},records.AKRA);
 // Admin: stable IDs survive rename/deactivation and category edits.
 await page.evaluate(()=>{ADMIN_SETTINGS_STATE.incidentBranch='AKRA';KpiIncident.admin();});
 await page.evaluate(id=>{KpiIncident.adminChange(id,'name','Renamed type');KpiIncident.adminChange(id,'active',false);KpiIncident.adminAddCategory();return KpiIncident.adminSave();},shared.id);
 assert.equal(await page.evaluate(id=>KPI_SYSTEM_CONFIG.incidentModel.branches.AKRA.types.find(t=>t.id===id).name,shared.id),'Renamed type');
 // Real existing admin screen: add, rename, associate and delete type/impact controls for both branches.
 for(const branch of ['TRD','AKRA']){
  await page.evaluate(b=>{currentBranch=b;currentRoles=['ADMIN'];IS_ADMIN=true;switchTab('admin');switchAdminSubTab('incidents');switchAdminIncidentBranch(b);},branch);
  const host=page.locator('#admin-incident-categories-list');
  await host.locator('button[onclick="KpiIncident.adminAddImpact()"] ').click();
  await host.getByLabel('ชื่อผลกระทบ',{exact:true}).last().fill('ผลกระทบทดลอง');
  await host.locator('button[onclick="KpiIncident.adminAdd()"] ').click();
  let card=host.locator('article').last();
  await card.getByLabel('ชื่อประเภท',{exact:true}).fill('ประเภททดลอง');
  await card.getByText('ผลกระทบทดลอง',{exact:true}).click();
  await page.locator('#btn-save-admin-incidents').click();
  await page.waitForFunction(b=>KPI_SYSTEM_CONFIG.incidentModel.branches[b].types.some(t=>t.name==='ประเภททดลอง'),branch);
  const custom=await page.evaluate(b=>({type:KPI_SYSTEM_CONFIG.incidentModel.branches[b].types.find(t=>t.name==='ประเภททดลอง'),impact:KPI_SYSTEM_CONFIG.incidentModel.branches[b].impacts.find(i=>i.label==='ผลกระทบทดลอง')}),branch);
  await page.evaluate(()=>{switchTab('error');selectedErrWorker='A';KpiIncident.reset();});
  await page.locator('#inc-quick-search').fill('ประเภททดลอง');await page.locator(`[data-type-id="${custom.type.id}"]`).click();
  await page.locator(`[data-impact="${custom.impact.id}"]`).click();
  assert.match(await page.locator('#impact-summary').innerText(),/ผลกระทบทดลอง/);
  await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);
  assert.equal(writes.at(-1).incident.impact,custom.impact.id);assert.match(await page.locator('#inc-success-summary').innerText(),/ผลกระทบทดลอง/);
  const caseId=writes.at(-1).incident.caseId;
  await page.evaluate(()=>{switchTab('admin');switchAdminSubTab('incidents');});
  await host.getByLabel('ชื่อผลกระทบ',{exact:true}).last().fill('ชื่อผลกระทบใหม่');await page.locator('#btn-save-admin-incidents').click();
  await page.waitForFunction(({b,id})=>KPI_SYSTEM_CONFIG.incidentModel.branches[b].impacts.find(i=>i.id===id).label==='ชื่อผลกระทบใหม่',{b:branch,id:custom.impact.id});
  await host.getByRole('button',{name:'ลบผลกระทบ',exact:true}).last().click();
  const revision=await page.evaluate(()=>KPI_SYSTEM_CONFIG.incidentModel.catalogRevision);
  await page.locator('#btn-save-admin-incidents').click();
  await page.waitForFunction(rev=>KPI_SYSTEM_CONFIG.incidentModel.catalogRevision > rev, revision);
  // Type with no impacts: can be selected and saved without error
  await page.evaluate(()=>{switchTab('error');selectedErrWorker='A';KpiIncident.reset();});
  await page.locator('#inc-quick-search').fill('ประเภททดลอง');await page.locator(`[data-type-id="${custom.type.id}"]`).click();
  assert.match(await page.locator('#inc-impact-options').innerText(),/ไม่มีผลกระทบต่อลูกค้า/);
  assert.match(await page.locator('#impact-summary').innerText(),/ไม่มีผลกระทบ/);
  await page.locator('#btn-save-error-preview').click();await page.waitForFunction(()=>!KpiIncident.state.busy);
  assert.equal(writes.at(-1).incident.impact,'');
  assert.match(await page.locator('#inc-success-summary').innerText(),/ไม่มีผลกระทบ/);
  await page.evaluate(()=>{switchTab('admin');switchAdminSubTab('incidents');});
  await host.locator('article').last().getByRole('button',{name:'ลบประเภท',exact:true}).click();await page.locator('#btn-save-admin-incidents').click();
  await page.waitForFunction(({b,id})=>!KPI_SYSTEM_CONFIG.incidentModel.branches[b].types.some(t=>t.id===id),{b:branch,id:custom.type.id});
  await page.evaluate(()=>switchTab('error'));
  const savedCard=page.locator('#pc-err-timeline article').filter({has:page.locator(`button[onclick="KpiIncident.edit('${caseId}')"]`)});
  assert.match(await savedCard.innerText(),/ผลกระทบทดลอง/,'history displays original snapshot after catalog rename/delete');
  assert.doesNotMatch(await savedCard.innerText(),/ชื่อผลกระทบใหม่/);
 }
 // Actual weekly dashboard must render impact metrics without a new HP score.
 await page.evaluate(()=>{originalLoadDashboardData();});assert.doesNotMatch(await page.locator('#dash-team-kpi').innerText(),/HP|Health Point/);
 await page.evaluate(()=>renderMyProfileView({name:'A',scoringMode:'none',qualityHp:null,incidentCount:7,customerIncidentCount:2,goodCatchCount:1,skills:[],roadmap:[],workloadStats:{}}));
 assert.equal(await page.locator('#my-profile-quality-score').textContent(),'7');assert.match(await page.locator('#my-profile-momentum-badge').textContent(),/ถึงลูกค้า 2 เคส/);
 await page.evaluate(()=>renderMyProfileView({name:'A',incidentDataUnavailable:true,skills:[],roadmap:[],workloadStats:{}}));assert.equal(await page.locator('#my-profile-quality-score').textContent(),'—');
 const download=page.waitForEvent('download');
 await page.evaluate(()=>{_paretoEvidence=buildParetoAnalysis([{date:'2026-09-08',sourceBranch:'AKRA',errors:recordedErrorCases.flatMap(r=>r.participants.map(emp=>({...r,emp})))}],'ALL','ALL',0).events;exportParetoEvidenceCSV();});
 const csv=fs.readFileSync(await(await download).path(),'utf8');assert.doesNotMatch(csv,/undefined|\"0\",/);assert.match(csv,/ผลกระทบ/);
 await page.evaluate(()=>{switchTab('error');KpiIncident.reset();});
 const artifacts=path.resolve(root,'..','.artifacts/kpi-incident-audit');fs.mkdirSync(artifacts,{recursive:true});
 await page.screenshot({path:path.join(artifacts,'impact-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(artifacts,'impact-desktop.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no desktop horizontal overflow');
 assert.deepEqual(errors,[]);console.log('PASS: mobile actual form quick/search equivalence, explicit impact, zero-score payload, both branches and consecutive saves.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
