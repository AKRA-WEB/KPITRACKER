const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(api) {
  const els = new Map();
  const element = id => {
    if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', value: '', classList: {add(){},remove(){},toggle(){}}, focus(){}, addEventListener(){}, querySelectorAll:()=>[] });
    return els.get(id);
  };
  const document = { getElementById: element, querySelectorAll: () => [], addEventListener(){}, body:{style:{}} };
  const notices = [];
  const window = { confirm:()=>true, AkraSupabaseKPI: api, getKpiTaskContext: () => ({token:'fixture',branch:'TRD',userUid:'u1',name:'Test',employees:[],can:()=>true}), showToast:msg=>notices.push(msg) };
  const context = vm.createContext({window,document,console,Intl,Date,Math,structuredClone,crypto:require('node:crypto').webcrypto,FormData:class {constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}}});
  for (const file of ['kpi-kanban-board.js','kpi-duty-matrix.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context);
  return {window,element,notices};
}

test('special characters in task and employee IDs remain literal handler arguments', async () => {
  const id = "legacy'); window.injected=true;//";
  const ui = setup({
    getKanbanBoard: async () => ({tasks:[{actionId:id,title:'Literal ID',ownerUid:'u1',status:'Open',checklist:[],comments:[]}],incomingIssues:[]}),
    getDutyMatrix: async () => ({catalog:[],assignments:[],capacities:[],employees:[{employeeUid:id,name:'Literal person'}]})
  });
  const decode = s => s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  await ui.window.KpiKanbanBoard.loadKanbanBoard();
  const board = ui.element('kb-board-content').innerHTML;
  let received;
  ui.window.KpiKanbanBoard.openTask = value => {received=value;};
  vm.runInNewContext(decode(board.match(/onclick="(window\.KpiKanbanBoard\.openTask[^\"]*)"/)[1]),{window:ui.window});
  assert.equal(received,'TRD::'+id);assert.equal(ui.window.injected,undefined);
  await ui.window.KpiDutyMatrix.loadDutyMatrix();
  ui.window.KpiDutyMatrix.runBranch = (branch,method,value) => {assert.equal(branch,'TRD');assert.equal(method,'openPerson');received=value;};
  vm.runInNewContext(decode(ui.element('kb-duty-content').innerHTML.match(/onclick="(window\.KpiDutyMatrix\.runBranch[^\"]*openPerson[^\"]*)"/)[1]),{window:ui.window});
  assert.equal(received,id);assert.equal(ui.window.injected,undefined);
});
test('flat API responses and canonical owner render; empty board never fabricates demo tasks', async () => {
  let tasks=[{actionId:'REAL-1',title:'Real persisted task',ownerUid:'u1',owner:'Owner One',status:'Open',revision:7,dueDate:'2026-10-02',checklist:[],activityLog:[]}];
  const ui=setup({getKanbanBoard:async(token,branch)=>{assert.equal(token,'fixture');assert.equal(branch,'TRD');return {status:'success',tasks,employees:[{employeeUid:'u1',name:'Owner One'}],incomingIssues:[]};}});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();
  assert.match(ui.element('kb-board-content').innerHTML,/Real persisted task/);
  assert.match(ui.element('kb-board-content').innerHTML,/Owner One/);
  assert.match(ui.element('kb-board-content').innerHTML,/ปัญหาแจ้งเข้า/);
  assert.match(ui.element('kb-board-content').innerHTML,/ยังไม่เชื่อมข้อมูล/);
  assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/รับงานนี้/);
  tasks=[]; await ui.window.KpiKanbanBoard.loadKanbanBoard();
  assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/KB-021|ISS-DEMO|จัดป้ายตำแหน่ง/);
});
test('issue lane is visible before integration without records or claim controls; ready data renders', async () => {
  let ready=false,claims=0;
  const ui=setup({getKanbanBoard:async()=>({tasks:[],issueIntegrationReady:ready,incomingIssues:[{id:'IS-1',title:'Reported issue fixture',description:'Details',area:'Warehouse',reporter:'Reporter',priority:'high'}]}),claimIssueTask:async()=>{claims++;}});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();
  let html=ui.element('kb-board-content').innerHTML;
  assert.match(html,/ปัญหาแจ้งเข้า/);assert.match(html,/ยังไม่เชื่อมข้อมูล/);
  assert.doesNotMatch(html,/Reported issue fixture|รับงานนี้|ไม่มีปัญหารอรับงาน/);
  ui.window.KpiKanbanBoard.openClaimIssueModal('TRD::IS-1');
  assert.equal(claims,0);assert.equal(ui.element('kpi-task-drawer').innerHTML,'');
  ready=true;await ui.window.KpiKanbanBoard.loadKanbanBoard();
  html=ui.element('kb-board-content').innerHTML;
  assert.match(html,/Reported issue fixture/);assert.match(html,/รับงานนี้/);
  assert.doesNotMatch(html,/ยังไม่เชื่อมข้อมูล/);
});

test('short task code is displayed while original UID remains the write identity', async()=>{
  const calls=[];const task={actionId:'KB-original-uuid',taskCode:'KB-1020260001',branch:'TRD',title:'Coded task',ownerUid:'u1',status:'Open',revision:1,checklist:[{id:'c1',text:'Check',done:false}],comments:[]};
  const ui=setup({getKanbanBoard:async()=>({tasks:[task]}),saveKanbanTask:async(token,payload)=>{calls.push(payload);return {task:{...task,...payload,revision:2}};}});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();assert.match(ui.element('kb-board-content').innerHTML,/>KB-1020260001</);
  ui.window.KpiKanbanBoard.openTask(task.actionId);assert.match(ui.element('kpi-task-drawer').innerHTML,/KB-1020260001/);
  await ui.window.KpiKanbanBoard.toggleChecklist(0,true);assert.equal(calls[0].actionId,'KB-original-uuid');
});

test('checklist text edits preserve completion, identity and siblings; blank/cancel/view-only do not write',async()=>{
  let task={actionId:'EDIT-1',branch:'TRD',title:'Edit',ownerUid:'u1',status:'Open',revision:4,checklist:[{id:'c1',text:'Before',done:true,extra:'keep'},{id:'c2',text:'Sibling',done:false}],comments:[]};
  const writes=[];const ui=setup({getKanbanBoard:async()=>({tasks:[task]}),saveKanbanTask:async(token,payload,revision)=>{writes.push({payload,revision});task={...task,...payload,revision:revision+1};return {task};}});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask(task.actionId);
  assert.match(ui.element('kpi-task-drawer').innerHTML,/แก้ไข Checklist ข้อ 1/);
  const input={value:'Draft',focus(){}},button={textContent:'บันทึก'},controls=[input,button];
  const form=ui.element('kb-checklist-edit-0');form.querySelector=selector=>selector.startsWith('input')?input:button;form.querySelectorAll=()=>controls;
  ui.window.KpiKanbanBoard.editChecklistItem(0);assert.equal(input.value,'Before');
  input.value='Discard';ui.window.KpiKanbanBoard.cancelChecklistEdit(0);assert.equal(writes.length,0);
  const event={preventDefault(){},target:form};input.value='  ';await ui.window.KpiKanbanBoard.saveChecklistItem(event,0);assert.equal(writes.length,0);
  input.value='  After <literal>  ';await ui.window.KpiKanbanBoard.saveChecklistItem(event,0);
  assert.equal(writes[0].revision,4);assert.equal(writes[0].payload.actionId,'EDIT-1');assert.equal(writes[0].payload.branch,'TRD');
  assert.deepEqual(JSON.parse(JSON.stringify(task.checklist)),[{id:'c1',text:'After <literal>',done:true,extra:'keep'},{id:'c2',text:'Sibling',done:false}]);
  await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask(task.actionId);assert.match(ui.element('kpi-task-drawer').innerHTML,/After &lt;literal&gt;/);
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'TRD',userUid:'other',employees:[],can:()=>false});
  ui.window.KpiKanbanBoard.openTask(task.actionId);assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/แก้ไข Checklist ข้อ/);
  await ui.window.KpiKanbanBoard.saveChecklistItem(event,0);assert.equal(writes.length,1);
});

test('pending checklist text save blocks duplicates and failed save preserves confirmed text',async()=>{
  const task={actionId:'EDIT-FAIL',branch:'TRD',title:'Edit',ownerUid:'u1',status:'Open',revision:4,checklist:[{id:'c',text:'Confirmed',done:true}],comments:[]};
  let rejectSave,count=0;const ui=setup({getKanbanBoard:async()=>({tasks:[task]}),saveKanbanTask:()=>{count++;return new Promise((resolve,reject)=>rejectSave=reject);}});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask(task.actionId);
  const input={value:'Draft'},button={textContent:'บันทึก'},controls=[input,button],event={preventDefault(){},target:{querySelector:s=>s.startsWith('input')?input:button,querySelectorAll:()=>controls}};
  const pending=ui.window.KpiKanbanBoard.saveChecklistItem(event,0);assert.equal(button.textContent,'กำลังบันทึก...');assert.ok(controls.every(c=>c.disabled));
  await ui.window.KpiKanbanBoard.saveChecklistItem(event,0);assert.equal(count,1);
  rejectSave(Error('fixture_failure'));await pending;assert.ok(controls.every(c=>!c.disabled));
  ui.window.KpiKanbanBoard.openTask(task.actionId);assert.match(ui.element('kpi-task-drawer').innerHTML,/Confirmed/);assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/Draft/);
});

test('combined owner filter deduplicates UID while keeping both branches and same-name distinct users',async()=>{
  const ui=setup({getKanbanBoard:async(token,branch)=>({tasks:[{actionId:'ADMIN-'+branch,title:'Admin task '+branch,branch,ownerUid:'admin',status:'Open'},{actionId:'STAFF-'+branch,title:'Staff task '+branch,branch,ownerUid:'staff-'+branch,status:'Open'}],employees:[{employeeUid:'admin',name:'Shared admin'},{employeeUid:'staff-'+branch,name:'Same name'}]})});
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',userUid:'admin',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],employees:[],can:()=>true});
  const handlers={};ui.element('kb-filter-owner').addEventListener=(event,fn)=>handlers[event]=fn;
  ui.window.KpiKanbanBoard.initEventListeners();await ui.window.KpiKanbanBoard.setBranchScope('ALL');
  const options=ui.element('kb-filter-owner').innerHTML;
  assert.equal((options.match(/value="admin"/g)||[]).length,1);assert.equal((options.match(/>Same name</g)||[]).length,2);
  handlers.change({target:{value:'admin'}});
  const board=ui.element('kb-board-content').innerHTML;assert.match(board,/Admin task AKRA/);assert.match(board,/Admin task TRD/);assert.doesNotMatch(board,/Staff task/);
  await ui.window.KpiKanbanBoard.loadKanbanBoard();assert.equal(ui.element('kb-filter-owner').value,'admin');
  ui.window.KpiKanbanBoard.openTask('TRD::ADMIN-TRD');const drawer=ui.element('kpi-task-drawer').innerHTML;
  assert.match(drawer,/value="admin"/);assert.match(drawer,/value="staff-TRD"/);assert.doesNotMatch(drawer,/value="staff-AKRA"/);
});

test('duty clicks stage immediately, cycle locally and save one batch without rereading',async()=>{
 let reads=0,finish;const calls=[];
 const matrix={catalog:['a','b'].map(id=>({id,name:id,weight:2,isActive:true})),assignments:[],employees:[{employeeUid:'u1',name:'One'}],employeeRevisions:{u1:0},drivingCapabilities:[{employeeUid:'u1',capabilities:{motorcycle:'capable'}}]};
 const ui=setup({getDutyMatrix:async()=>{reads++;return matrix;},saveDutyAssignments:async(t,p)=>{calls.push(p);return new Promise(r=>finish=r);}});
 await ui.window.KpiDutyMatrix.loadDutyMatrix();
 for(let i=0;i<3;i++)await ui.window.KpiDutyMatrix.cycleAssignment('u1','a');
 assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),false);assert.equal(calls.length,0);
 await ui.window.KpiDutyMatrix.cycleAssignment('u1','a');await ui.window.KpiDutyMatrix.cycleAssignment('u1','b');
 assert.equal(matrix.assignments.length,0);
 const pending=ui.window.KpiDutyMatrix.saveDrafts();await ui.window.KpiDutyMatrix.saveDrafts();await ui.window.KpiDutyMatrix.cycleAssignment('u1','a');
 assert.equal(calls.length,1);assert.equal(calls[0].changes.length,2);assert.ok(calls[0].changes.every(c=>c.targetType==='secondary'&&c.expectedRevision===0));
 finish({matrices:{TRD:{...matrix,assignments:calls[0].changes.map(c=>({...c,assignmentType:c.targetType})),employeeRevisions:{u1:2}}}});await pending;
 assert.equal(reads,1);assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),false);
 await ui.window.KpiDutyMatrix.cycleAssignment('u1','a');const next=ui.window.KpiDutyMatrix.saveDrafts();assert.equal(calls[1].changes[0].expectedRevision,2);assert.equal(calls[1].changes[0].targetType,'primary');
 finish({matrices:{TRD:{...matrix,assignments:[{employeeUid:'u1',dutyId:'a',assignmentType:'primary'},{employeeUid:'u1',dutyId:'b',assignmentType:'secondary'}],employeeRevisions:{u1:3}}}});await next;
});

test('failed batch retains drafts, retries same request and conflict blocks another save',async()=>{
 const calls=[];let failure='request_timeout';
 const matrix={catalog:[{id:'d',name:'Duty',weight:1,isActive:true}],assignments:[],employees:[{employeeUid:'u1',name:'One'}],employeeRevisions:{u1:0}};
 const ui=setup({getDutyMatrix:async()=>matrix,saveDutyAssignments:async(t,p)=>{calls.push(p);throw Object.assign(Error(failure),{reason:failure});}});
 await ui.window.KpiDutyMatrix.loadDutyMatrix();await ui.window.KpiDutyMatrix.cycleAssignment('u1','d');await ui.window.KpiDutyMatrix.saveDrafts();assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),true);
 await ui.window.KpiDutyMatrix.cycleAssignment('u1','d');failure='record_conflict';await ui.window.KpiDutyMatrix.saveDrafts();assert.deepEqual(calls[1],calls[0]);
 await ui.window.KpiDutyMatrix.saveDrafts();assert.equal(calls.length,2);ui.window.KpiDutyMatrix.discardDrafts();await new Promise(r=>setImmediate(r));assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),false);
});

test('primary draft demotes previous primary and declined navigation keeps drafts',async()=>{
 let payload;const matrix={catalog:['a','b'].map(id=>({id,name:id,weight:1,isActive:true})),assignments:[{employeeUid:'u1',dutyId:'a',assignmentType:'primary'}],employees:[{employeeUid:'u1',name:'One'}],employeeRevisions:{u1:3}};
 const ui=setup({getDutyMatrix:async()=>matrix,saveDutyAssignments:async(t,p)=>{payload=p;return {matrices:{TRD:{...matrix,assignments:p.changes.map(c=>({...c,assignmentType:c.targetType})),employeeRevisions:{u1:5}}}};}});
 await ui.window.KpiDutyMatrix.loadDutyMatrix();await ui.window.KpiDutyMatrix.cycleAssignment('u1','b');await ui.window.KpiDutyMatrix.cycleAssignment('u1','b');
 ui.window.confirm=()=>false;assert.equal(ui.window.KpiDutyMatrix.confirmLeave(),false);await ui.window.KpiDutyMatrix.loadDutyMatrix();assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),true);
 await ui.window.KpiDutyMatrix.saveDrafts();assert.equal(payload.changes.find(c=>c.dutyId==='a').targetType,'secondary');assert.equal(payload.changes.find(c=>c.dutyId==='b').targetType,'primary');
 await ui.window.KpiDutyMatrix.cycleAssignment('u1','b');ui.window.KpiDutyMatrix.discardDrafts();assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),false);
});

test('session change during save clears previous private matrix',async()=>{
 let finish;const ui=setup({getDutyMatrix:async()=>({catalog:[{id:'d',name:'Duty',weight:1,isActive:true}],assignments:[],employees:[{employeeUid:'u1',name:'Private old user'}],employeeRevisions:{u1:0}}),saveDutyAssignments:()=>new Promise(r=>finish=r)});
 await ui.window.KpiDutyMatrix.loadDutyMatrix();await ui.window.KpiDutyMatrix.cycleAssignment('u1','d');const pending=ui.window.KpiDutyMatrix.saveDrafts();
 ui.window.getKpiTaskContext=()=>({token:'new',branch:'AKRA',can:()=>true});finish({matrices:{}});await pending;assert.equal(ui.window.KpiDutyMatrix.hasDrafts(),false);assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/Private old user/);
});

test('checklist/comments persist through API with current revision and survive refresh', async () => {
  let task={actionId:'REAL-1',title:'Persisted',ownerUid:'u1',owner:'One',status:'Open',revision:5,dueDate:'2026-10-02',checklist:[{id:'item',text:'Check',done:false}],comments:[]};
  const calls=[];
  const ui=setup({getKanbanBoard:async()=>({status:'success',tasks:[task],incomingIssues:[]}),saveKanbanTask:async(token,item,revision)=>{
    assert.equal(revision,task.revision);calls.push(item);task={...item,owner:'One',revision:revision+1};return {status:'success',task};
  }});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask('REAL-1');
  await ui.window.KpiKanbanBoard.toggleChecklist(0,true);assert.equal(task.checklist[0].done,true);
  await ui.window.KpiKanbanBoard.addComment({preventDefault(){},target:{querySelector:()=>({value:'Update from fixture'})}});
  assert.equal(task.comments.length,1);assert.equal(task.revision,7);assert.equal(calls.length,2);
  await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask('REAL-1');
  assert.ok(ui.element('kpi-task-drawer').innerHTML.includes('Update from fixture'));
});

test('combined board keeps duplicate IDs and writes to the selected task branch', async () => {
  const calls=[];
  const rows=Object.fromEntries(['AKRA','TRD'].map(branch=>[branch,{actionId:'SAME-ID',title:branch+' task',ownerUid:'u1',owner:branch+' owner',status:'Open',revision:1,checklist:[{id:'c',text:branch,done:false}],comments:[]}]));
  const ui=setup({getKanbanBoard:async(token,branch)=>({tasks:[rows[branch]],employees:[{employeeUid:'u1',name:branch+' owner'}]}),saveKanbanTask:async(token,item)=>{calls.push(item);rows[item.branch]={...item,revision:2};return {task:rows[item.branch]};}});
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',userUid:'u1',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>true});
  await ui.window.KpiKanbanBoard.setBranchScope('ALL');
  assert.match(ui.element('kb-board-content').innerHTML,/AKRA task/);assert.match(ui.element('kb-board-content').innerHTML,/TRD task/);
  ui.window.KpiKanbanBoard.openTask('TRD::SAME-ID');
  assert.match(ui.element('kpi-task-drawer').innerHTML,/สาขา TRD/);
  assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/AKRA owner/);
  await ui.window.KpiKanbanBoard.toggleChecklist(0,true);
  assert.equal(calls[0].branch,'TRD');assert.equal(calls[0].actionId,'SAME-ID');assert.equal(rows.AKRA.checklist[0].done,false);
});

test('combined duty drafts save once using branch-specific baseline revisions',async()=>{
 const calls=[];const matrices=Object.fromEntries(['AKRA','TRD'].map(branch=>[branch,{catalog:[{id:'d',name:branch+' Duty',weight:2,targetHeadcount:1,isActive:true}],assignments:[],employees:[{employeeUid:'u1',name:branch+' Person'}],employeeRevisions:{u1:branch==='AKRA'?8:3}}]));
 const ui=setup({getDutyMatrix:async(t,b)=>matrices[b],saveDutyAssignments:async(t,p)=>{calls.push(p);return {matrices:Object.fromEntries(p.changes.map(c=>[c.branch,{...matrices[c.branch],assignments:[{...c,assignmentType:c.targetType}],employeeRevisions:{u1:c.expectedRevision+1}}]))};}});
 ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>true});await ui.window.KpiDutyMatrix.setBranchScope('ALL');
 await ui.window.KpiDutyMatrix.runBranch('TRD','cycleAssignment','u1','d');await ui.window.KpiDutyMatrix.runBranch('AKRA','cycleAssignment','u1','d');assert.equal(calls.length,0);assert.equal(matrices.AKRA.assignments.length,0);
 await ui.window.KpiDutyMatrix.saveDrafts();assert.equal(calls.length,1);assert.equal(calls[0].changes.find(c=>c.branch==='TRD').expectedRevision,3);assert.equal(calls[0].changes.find(c=>c.branch==='AKRA').expectedRevision,8);
});

test('single branch viewer cannot request ALL/foreign branch and failed combined reads show an error', async () => {
  const calls=[];
  const ui=setup({getKanbanBoard:async(token,branch)=>{calls.push(branch);if(branch==='TRD')throw Error('permission_denied');return {tasks:[],employees:[]};},getDutyMatrix:async()=>({catalog:[],assignments:[]})});
  await ui.window.KpiKanbanBoard.setBranchScope('AKRA');await ui.window.KpiKanbanBoard.setBranchScope('ALL');assert.equal(calls.length,0);
  await ui.window.KpiDutyMatrix.setBranchScope('AKRA');assert.equal(ui.element('kb-duty-content').innerHTML,'');
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>true});
  await ui.window.KpiKanbanBoard.setBranchScope('ALL');
  assert.match(ui.element('kb-board-content').innerHTML,/role="alert"/);
});

test('task creation requires an explicit branch and an employee from that branch', async () => {
  const calls=[];
  const ui=setup({getKanbanBoard:async(token,branch)=>({tasks:[],employees:[{employeeUid:branch+'-person',name:branch+' person'}]}),saveKanbanTask:async(token,item)=>{calls.push(item);return {task:{...item,revision:1}};}});
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],userUid:'TRD-person',can:()=>true});
  await ui.window.KpiKanbanBoard.setBranchScope('ALL');
  const submit=values=>ui.window.KpiKanbanBoard.handleCreateTask({preventDefault(){},target:{values:{title:'New',status:'open',priority:'normal',...values}}});
  await submit({owner:'TRD-person'});assert.equal(calls.length,0);
  await submit({branch:'TRD',owner:'AKRA-person'});assert.equal(calls.length,0);
  await submit({branch:'TRD',owner:'TRD-person'});assert.equal(calls.length,1);assert.equal(calls[0].branch,'TRD');assert.equal(calls[0].ownerUid,'TRD-person');
});

test('ordinary dual-role staff stay in their own branch; only Supervisor/Admin can combine', async () => {
 for(const role of ['WAREHOUSE','AKRA','TRD','SUPERVISOR','ADMIN']) {
  const calls=[];
  const ui=setup({getKanbanBoard:async(token,branch)=>{calls.push('board:'+branch);return {tasks:[],employees:[]};},getDutyMatrix:async(token,branch)=>{calls.push('duty:'+branch);return {catalog:[],assignments:[],employees:[]};}});
  const privileged=['SUPERVISOR','ADMIN'].includes(role);
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',roles:privileged?[role]:[role,'AKRA','TRD'],allowedBranches:['AKRA','TRD'],can:()=>true});
  await ui.window.KpiKanbanBoard.loadKanbanBoard();await ui.window.KpiDutyMatrix.loadDutyMatrix();
  if(!privileged){assert.doesNotMatch(ui.element('kb-branch-scope').innerHTML,/TRD|ALL/);assert.doesNotMatch(ui.element('kb-duty-branch-scope').innerHTML,/TRD|ALL/);}
  calls.length=0;
  await ui.window.KpiKanbanBoard.setBranchScope('ALL');await ui.window.KpiDutyMatrix.setBranchScope('ALL');
  await ui.window.KpiKanbanBoard.setBranchScope('TRD');await ui.window.KpiDutyMatrix.setBranchScope('TRD');
  if(privileged){assert.ok(calls.includes('board:TRD'));assert.ok(calls.includes('duty:TRD'));}
  else assert.equal(calls.length,0,'ordinary staff must never request foreign data');
 }
});

test('driving capabilities persist independently of duties, filter only capable and keep branch revisions', async()=>{
 const calls=[];
 const matrices=Object.fromEntries(['AKRA','TRD'].map(branch=>[branch,{catalog:[],assignments:[],employees:[{employeeUid:'u1',name:branch+' Driver'},{employeeUid:'u2',name:branch+' Unknown'}],drivingCapabilities:[{employeeUid:'u1',revision:branch==='AKRA'?4:8,capabilities:{motorcycle:'capable',cargo34:'supervised',car_pickup:'unknown'}}]}]));
 const ui=setup({getDutyMatrix:async(token,branch)=>matrices[branch],setDrivingCapabilities:async(token,item)=>{calls.push(item);matrices[item.branch].drivingCapabilities=[{...item,revision:item.expectedRevision+1}];return {status:'success'};}});
 ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>true});
 await ui.window.KpiDutyMatrix.setBranchScope('ALL');
 assert.match(ui.element('kb-duty-content').innerHTML,/ดูทักษะขับขี่/);assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/มอเตอร์ไซค์|รถเครื่องขนสินค้า/);assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/ทักษะขับขี่ · ยังไม่ระบุ/);
 ui.window.KpiDutyMatrix.setDrivingFilter('cargo34');assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/AKRA Driver|TRD Driver/);
 ui.window.KpiDutyMatrix.setDrivingFilter('motorcycle');assert.match(ui.element('kb-duty-content').innerHTML,/AKRA Driver|TRD Driver/);assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/AKRA Unknown|TRD Unknown/);
 await ui.window.KpiDutyMatrix.runBranch('TRD','openPerson','u1');
 assert.match(ui.element('kpi-task-drawer').innerHTML,/รถเครื่องขนสินค้า 3 ล้อ \/ 4 ล้อ/);
 await ui.window.KpiDutyMatrix.saveDrivingCapabilities({preventDefault(){},target:{values:{motorcycle:'capable',cargo34:'supervised',car_pickup:'capable'}}},'u1');
 assert.equal(calls[0].branch,'TRD');assert.equal(calls[0].expectedRevision,8);assert.equal(matrices.AKRA.drivingCapabilities[0].revision,4);
 await ui.window.KpiDutyMatrix.loadDutyMatrix();await ui.window.KpiDutyMatrix.runBranch('TRD','openPerson','u1');assert.match(ui.element('kpi-task-drawer').innerHTML,/<option value="capable" selected>ขับได้/);assert.equal(matrices.TRD.drivingCapabilities[0].capabilities.car_pickup,'capable');assert.equal(matrices.TRD.assignments.length,0);
});
test('driving failed save retains old skills and view-only editor hides save',async()=>{
 const matrix={catalog:[],assignments:[],employees:[{employeeUid:'u1',name:'One'}],drivingCapabilities:[]};
 const ui=setup({getDutyMatrix:async()=>matrix,setDrivingCapabilities:async()=>{throw Error('record_conflict');}});
 await ui.window.KpiDutyMatrix.loadDutyMatrix();ui.window.KpiDutyMatrix.openPerson('u1');
 await ui.window.KpiDutyMatrix.saveDrivingCapabilities({preventDefault(){},target:{values:{motorcycle:'capable',cargo34:'unknown',car_pickup:'unknown'}}},'u1');
 assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/ทักษะขับขี่ · ยังไม่ระบุ/);assert.ok(ui.notices.some(m=>m.includes('ไม่สำเร็จ')));assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/ดูทักษะขับขี่/);
 ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'TRD',can:()=>false});ui.window.KpiDutyMatrix.openPerson('u1');
 assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/บันทึกทักษะขับขี่<\/button>/);assert.match(ui.element('kpi-task-drawer').innerHTML,/disabled/);
});
