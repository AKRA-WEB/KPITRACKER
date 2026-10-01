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
  const window = { AkraSupabaseKPI: api, getKpiTaskContext: () => ({token:'fixture',branch:'TRD',userUid:'u1',name:'Test',employees:[],can:()=>true}), showToast:msg=>notices.push(msg) };
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

test('duty writes use API targetType and failed saves keep original allocation', async () => {
  const calls=[];
  const matrix={status:'success',catalog:[{id:'inbound',name:'Receiving',weight:2,targetHeadcount:null,isActive:true,revision:3}],assignments:[],capacities:[],employees:[{employeeUid:'u1',name:'Owner One'}]};
  const ui=setup({getDutyMatrix:async()=>matrix,setDutyAssignment:async(token,payload)=>{calls.push(payload);throw Error('record_conflict');}});
  await ui.window.KpiDutyMatrix.loadDutyMatrix();
  assert.match(ui.element('kb-duty-content').innerHTML,/Owner One/);
  await ui.window.KpiDutyMatrix.cycleAssignment('u1','inbound');
  assert.equal(calls.length,1); assert.equal(calls[0].targetType,'primary');
  assert.ok(ui.notices.some(msg=>/ไม่สำเร็จ/.test(msg)));
  assert.doesNotMatch(ui.element('kb-duty-content').innerHTML,/เกินขีดจำกัด/);
});
test('duty click consumes authoritative save response without rereading, preserves skills and blocks duplicates', async () => {
  let reads=0,finish;const calls=[];
  const matrix={catalog:[{id:'inbound',name:'Receiving',weight:2,isActive:true,revision:1}],assignments:[],employees:[{employeeUid:'u1',name:'One'}],capacities:[],employeeRevisions:{u1:0},drivingCapabilities:[{employeeUid:'u1',capabilities:{motorcycle:'capable'}}]};
  const ui=setup({getDutyMatrix:async()=>{reads++;return structuredClone(matrix);},setDutyAssignment:async(token,payload)=>{calls.push(payload);return new Promise(resolve=>{finish=resolve;});}});
  await ui.window.KpiDutyMatrix.loadDutyMatrix();
  const attrs={};const cell={dataset:{dutyBranch:'TRD',dutyPerson:'u1',dutyId:'inbound'},innerHTML:'+',disabled:false,setAttribute:(key,value)=>{attrs[key]=value;},removeAttribute:key=>{delete attrs[key];}};
  const scroller={dataset:{dutyScroll:'TRD'},scrollLeft:260};
  ui.element('kb-duty-content').querySelectorAll=selector=>selector==='[data-duty-cell]'?[cell]:selector==='[data-duty-scroll]'?[scroller]:[];
  const pending=ui.window.KpiDutyMatrix.cycleAssignment('u1','inbound');
  assert.equal(cell.disabled,true);assert.equal(attrs['aria-busy'],'true');assert.match(cell.innerHTML,/กำลังบันทึก/);
  await ui.window.KpiDutyMatrix.cycleAssignment('u1','inbound');assert.equal(calls.length,1);
  finish({...matrix,drivingCapabilities:undefined,assignments:[{employeeUid:'u1',dutyId:'inbound',assignmentType:'primary'}],employeeRevisions:{u1:1}});
  await pending;
  assert.equal(cell.disabled,false);assert.equal(attrs['aria-busy'],undefined);assert.equal(scroller.scrollLeft,260);
  assert.equal(reads,1,'successful mutation response eliminates additional reads');
  assert.match(ui.element('kb-duty-content').innerHTML,/งานหลัก/);
  assert.match(ui.element('kb-duty-content').innerHTML,/ทักษะขับขี่/);
  const next=ui.window.KpiDutyMatrix.cycleAssignment('u1','inbound');
  assert.equal(calls[1].expectedRevision,1);assert.equal(calls[1].targetType,'secondary');
  finish({...matrix,assignments:[{employeeUid:'u1',dutyId:'inbound',assignmentType:'secondary'}],employeeRevisions:{u1:2}});await next;
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

test('combined duty tables keep coverage, person revisions and writes branch bound', async () => {
  const calls=[];
  const matrices=Object.fromEntries(['AKRA','TRD'].map(branch=>[branch,{catalog:[{id:'same-duty',name:branch+' Duty',weight:2,targetHeadcount:1,isActive:true}],assignments:branch==='AKRA'?[{employeeUid:'u1',dutyId:'same-duty',assignmentType:'primary'}]:[],employees:[{employeeUid:'u1',name:branch+' Person'}],capacities:[],employeeRevisions:{u1:branch==='AKRA'?8:3}}]));
  const ui=setup({getDutyMatrix:async(token,branch)=>matrices[branch],setDutyAssignment:async(token,item)=>{calls.push(item);matrices[item.branch].assignments=[{employeeUid:item.employeeUid,dutyId:item.dutyId,assignmentType:item.targetType}];return {};} });
  ui.window.getKpiTaskContext=()=>({token:'fixture',branch:'AKRA',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>true});
  await ui.window.KpiDutyMatrix.setBranchScope('ALL');
  assert.match(ui.element('kb-duty-content').innerHTML,/ตารางงานสาขา AKRA/);assert.match(ui.element('kb-duty-content').innerHTML,/ตารางงานสาขา TRD/);
  assert.match(ui.element('kb-duty-summary').innerHTML,/AKRA: 1 คน · 0 หน้าที่ขาดคน/);assert.match(ui.element('kb-duty-summary').innerHTML,/TRD: 1 คน · 1 หน้าที่ขาดคน/);
  await ui.window.KpiDutyMatrix.runBranch('TRD','cycleAssignment','u1','same-duty');
  assert.equal(calls[0].branch,'TRD');assert.equal(calls[0].expectedRevision,3);assert.equal(calls[0].targetType,'primary');
  assert.equal(matrices.AKRA.employeeRevisions.u1,8);assert.equal(matrices.AKRA.assignments.length,1);
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
