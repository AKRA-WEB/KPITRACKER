// Actual board/client code in isolated synthetic runtimes. No real requests,
// employee records, Storage writes or provider sends.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const row=(actionId='KB-1',extra={})=>({id:'20000000-0000-4000-8000-000000000001',actionId,branch:'AKRA',title:'Fixture',ownerUid:'u1',owner:'One',status:'Open',revision:1,
  dueDate:'2026-10-10',createdDate:'2026-10-10T01:00:00Z',checklist:[],comments:[],attachments:[],...extra});
const drain=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}) {
  const elements=new Map(),calls=[],saves=[];let tasks=options.tasks||[row()];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},focus(){},
      addEventListener(){},querySelectorAll:()=>[],setAttribute(){}});
    return elements.get(id);
  };
  let identity={token:'synthetic',branch:'AKRA',userUid:'u1',name:'One',roles:['AKRA'],can:()=>true};
  const api={getKanbanBoard:async()=>({tasks,incomingIssues:options.incomingIssues||[],issueIntegrationReady:true,employees:[{employeeUid:'u1',name:'One'}]})};
  api.saveKanbanTask=async(token,payload,revision)=>{saves.push({token,payload,revision});return {task:row(payload.actionId,{...payload,revision:revision+1})};};
  if(!options.oldClient)api.getKanbanLineDelivery=async(token,payload)=>{
    calls.push({token,payload});return options.read?options.read(token,payload):{status:'success',delivery:{state:options.state||'accepted',reason:options.reason||''}};
  };
  const window={getKpiTaskContext:()=>identity,AkraSupabaseKPI:api};
  const document={getElementById:element,querySelectorAll:()=>[],addEventListener(){},body:{style:{}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/kpi-kanban-board.js'),'utf8'),{window,document,console,Intl,Date,Math,FormData:class{constructor(values){this.values=values;}get(key){return this.values[key];}}});
  return {board:window.KpiKanbanBoard,element,calls,saves,setIdentity:values=>identity={...identity,...values},setTasks:values=>tasks=values};
}

test('no-deadline task edits allow an empty date and preserve null; dated tasks retain required date',async()=>{
 for(const extra of [{dueDate:null},{dueDate:null,noDeadline:true},{dueDate:'2026-10-10'}]){
  const ui=setup({tasks:[row('KB-1',extra)]});await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');await drain();
  const date=ui.element('kpi-task-drawer').innerHTML.match(/<input type="date" name="due"[^>]*>/)[0];assert.equal(/\brequired\b/.test(date),extra.dueDate!==null);
  assert.match(ui.element('kpi-task-drawer').innerHTML,/วันที่แสดงเป็น พ.ศ. · เลือกวันตามปฏิทินของอุปกรณ์/);
  if(extra.dueDate===null){await ui.board.handleSaveTask({preventDefault(){},target:{owner:'u1',due:'',status:'open',next:'',blocked:'',note:''}});assert.equal(ui.saves.length,1);assert.equal(ui.saves[0].payload.dueDate,null);assert.equal(ui.saves[0].revision,1);}
 }
});
test('each server delivery state is read-only, distinct from task status and employee read receipt',async()=>{
  const labels={not_queued:'ยังไม่ได้ส่ง LINE',pending:'รอส่ง LINE',sending:'กำลังส่ง LINE',accepted:'LINE รับคำขอแล้ว',failed:'ส่ง LINE ไม่สำเร็จ',expired:'คำขอส่ง LINE หมดอายุ',suppressed:'ยกเลิกการส่ง LINE สำหรับงานนี้'};
  for(const [state,label] of Object.entries(labels)) {
    const ui=setup({state,reason:state==='not_queued'?'no_route':''});await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');await drain();
    assert.match(ui.element('kb-line-delivery-status').textContent,new RegExp(label));
    assert.match(ui.element('kpi-task-drawer').innerHTML,/ไม่ได้หมายถึงผู้รับอ่านแล้ว/);
    assert.deepEqual(JSON.parse(JSON.stringify(ui.calls)),[{token:'synthetic',payload:{branch:'AKRA',taskId:row().id}}]);
  }
});
test('older client/server, missing UUID, bad response and provider errors remain unknown',async()=>{
  for(const options of [{oldClient:true},{tasks:[row('KB-1',{id:undefined})]},
    {read:async()=>{throw Error('action_not_found');}},{read:async()=>({status:'success'})},
    {read:async()=>{throw Error('secret provider error');}}]) {
    const ui=setup(options);await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');await drain();
    assert.match(ui.element('kb-line-delivery-status').textContent,/ยังตรวจสอบสถานะส่ง LINE ไม่ได้/);
    assert.doesNotMatch(ui.element('kb-line-delivery-status').textContent,/secret|รับคำขอแล้ว|ยังไม่ได้ส่ง LINE/);
  }
});
test('safe mapped reasons are rendered; raw provider/identity details never enter UI',async()=>{
  const ui=setup({state:'failed',reason:'<script>private user</script>'});await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');await drain();
  assert.equal(ui.element('kb-line-delivery-status').textContent,'ส่ง LINE ไม่สำเร็จ');
});

test('prototype-named delivery values stay unknown and prototype-named reasons never render',async()=>{
 for(const state of ['constructor','__proto__']){
  const ui=setup({state});await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');await drain();
  assert.match(ui.element('kb-line-delivery-status').textContent,/ยังตรวจสอบสถานะส่ง LINE ไม่ได้/);
 }
 for(const reason of ['constructor','__proto__']){
  const ui=setup({state:'failed',reason});await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');await drain();
  assert.equal(ui.element('kb-line-delivery-status').textContent,'ส่ง LINE ไม่สำเร็จ');
 }
});

test('adding a deadline to a canonical no-deadline task keeps Gregorian wire dates; new and claimed tasks require dates',async()=>{
 const ui=setup({tasks:[row('KB-1',{dueDate:null})],incomingIssues:[{id:'IS-1',title:'Fixture issue'}]});await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');
 await ui.board.handleSaveTask({preventDefault(){},target:{owner:'u1',due:'2026-10-14',status:'open',next:'',blocked:'',note:''}});
 assert.equal(ui.saves.length,1);assert.equal(ui.saves[0].payload.dueDate,'2026-10-14');
 ui.board.openNewTaskModal();assert.match(ui.element('kpi-task-drawer').innerHTML,/<input type="date" name="due"[^>]*\brequired\b/);
 ui.board.openClaimIssueModal('AKRA::IS-1');assert.match(ui.element('kpi-task-drawer').innerHTML,/Fixture issue/);assert.match(ui.element('kpi-task-drawer').innerHTML,/<input type="date" name="due"[^>]*\brequired\b/);
});

test('delivery transport is a read and never marks saved or invokes mutation orchestration',async()=>{
 let mutations=0,saved=0,requests=0;const owner={token:'synthetic'};
 const window={getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>owner.token,AkraModule:{embedded:true,runMutation(){mutations++;},markSaved(){saved++;}}};
 const c=vm.createContext({window,AbortController,setTimeout,clearTimeout,fetch:async()=>{requests++;return{ok:true,json:async()=>({status:'success',delivery:{state:'not_queued',reason:'dispatch_disabled'}})};}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8'),c);
 await c.AkraSupabaseKPI.getKanbanLineDelivery(owner.token,{branch:'AKRA',taskId:row().id});
 assert.equal(requests,1);assert.equal(mutations,0);assert.equal(saved,0);
});
test('late responses after close, new drawer, identity, token, branch, owner or revision change cannot paint stale delivery',async()=>{
  for(const change of ['close','new','another','token','identity','branch','owner','revision']) {
    let resolve;const promise=new Promise(done=>resolve=done);
    const ui=setup({read:()=>promise,tasks:[row(),row('KB-2',{id:'20000000-0000-4000-8000-000000000002'})]});
    await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');
    if(change==='close')ui.board.closeDrawer();
    if(change==='new')ui.board.openNewTaskModal();
    if(change==='another')ui.board.openTask('KB-2');
    if(change==='token')ui.setIdentity({token:'new'});
    if(change==='identity')ui.setIdentity({userUid:'u2'});
    if(change==='branch')ui.setIdentity({branch:'TRD'});
    if(['owner','revision'].includes(change)){ui.setTasks([row('KB-1',change==='owner'?{ownerUid:'u2'}:{revision:2})]);await ui.board.loadKanbanBoard();}
    resolve({status:'success',delivery:{state:'accepted'}});await drain();
    // A newer task read is allowed to populate its own drawer; old responses are
    // separately proved below with different pending read results.
    if(change!=='another')assert.doesNotMatch(ui.element('kb-line-delivery-status').textContent,/LINE รับคำขอแล้ว/,change);
  }
});
test('opening another task discards the first task result',async()=>{
  const pending=[];const ui=setup({read:()=>new Promise(resolve=>pending.push(resolve)),tasks:[row(),row('KB-2',{id:'20000000-0000-4000-8000-000000000002'})]});
  await ui.board.loadKanbanBoard();ui.board.openTask('KB-1');ui.board.openTask('KB-2');
  pending[1]({delivery:{state:'failed'}});await drain();pending[0]({delivery:{state:'accepted'}});await drain();
  assert.equal(ui.element('kb-line-delivery-status').textContent,'ส่ง LINE ไม่สำเร็จ');
});
test('client sends canonical task and branch through current session transport; old response rejects',async()=>{
  let handler,request;const owner={token:'old'};let token='current';
  const window={getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>token};
  const sandbox={window,console,setTimeout,clearTimeout,AbortController,fetch:async(_url,options)=>{
    request=JSON.parse(options.body);return handler(options);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8'),sandbox);
  handler=async()=>({ok:true,json:async()=>({status:'success',delivery:{state:'not_queued'}})});
  const client=sandbox.AkraSupabaseKPI;await client.getKanbanLineDelivery('old',{taskId:row().id,branch:'AKRA',identityId:'spoof'});
  assert.deepEqual(request,{action:'getKanbanLineDelivery',token:'current',branch:'AKRA',taskId:row().id});
  handler=async()=>({ok:true,json:async()=>({status:'success'})});
  await assert.rejects(client.getKanbanLineDelivery('current',{taskId:row().id,branch:'AKRA'}),/invalid_line_delivery_response/);
  handler=async()=>{token='other';return {ok:true,json:async()=>({status:'success',delivery:{state:'accepted'}})};};
  await assert.rejects(client.getKanbanLineDelivery('current',{taskId:row().id,branch:'AKRA'}),/session_changed/);
});
