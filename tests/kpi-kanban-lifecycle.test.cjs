// Execute the actual controller/client with synthetic records and transports only.
// This VM fixture does not provide real browser evidence.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const uuid='11111111-1111-4111-8111-111111111111';
const requestUuid='22222222-2222-4222-8222-222222222222';
const row=(extra={})=>({id:uuid,actionId:'SYNTHETIC',taskCode:'KB-SYNTHETIC',branch:'AKRA',title:'Synthetic task',
    ownerUid:'one',owner:'One',status:'Resolved',revision:7,isArchived:false,createdDate:'2026-10-01T00:00:00Z',
    resolutionDate:'2026-10-10T00:00:00Z',checklist:[{id:'check',text:'Keep',done:true}],
    comments:[{id:'comment',text:'Keep comment'}],activityLog:[{details:'Keep history'}],attachments:[],...extra});
const clone=value=>JSON.parse(JSON.stringify(value));
const drain=()=>new Promise(resolve=>setImmediate(resolve));

function setup(initial=[row()],options={}) {
    const tasks=clone(initial),elements=new Map(),calls=[],notices=[],changed=[];
    let identity={token:'synthetic',branch:'AKRA',userUid:'one',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>true,...options.identity};
    const element=id=>{
        if(!elements.has(id)){const classes=new Set();elements.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,handlers:{},
            classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},contains:value=>classes.has(value),toggle(value,force){if(force??!classes.has(value))classes.add(value);else classes.delete(value);}},
            setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},focus(){},querySelectorAll:()=>[],querySelector:()=>null});}
        return elements.get(id);
    };
    const respond=async(action,payload,defaultResult)=>{calls.push({action,payload:clone(payload)});return options[action]?options[action](payload,tasks):defaultResult;};
    const api={
        getKanbanBoard:async(token,branch,readOptions)=>respond('read',{branch,...readOptions},{status:'success',tasks:tasks.filter(task=>task.branch===branch),employees:[{employeeUid:'one',name:'One'}],incomingIssues:[]}),
        saveKanbanTask:async(token,payload)=>respond('save',payload,{status:'success',task:{...tasks[0],...payload,revision:payload.revision+1}}),
        setKanbanTaskArchived:async(token,payload)=>respond('archive',payload,{status:'success',task:{...tasks[0],isArchived:payload.archived,revision:payload.expectedRevision+1}}),
        deleteKanbanTask:async(token,payload)=>respond('delete',payload,{status:'success',...payload,deleted:true,state:'completed'}),
        getKanbanTaskDeletion:async(token,payload)=>respond('receipt',payload,{status:'success',...payload,state:'not_started'}),
        ...options.api
    };
    const window={getKpiTaskContext:()=>identity,AkraSupabaseKPI:api,showToast:message=>notices.push(message),
        onKpiTaskChanged:task=>changed.push(task),confirm:()=>true};
    const document={getElementById:element,querySelectorAll:()=>[],addEventListener(){},body:{style:{}}};
    const context=vm.createContext({window,document,console,Intl,Date,Math,crypto:webcrypto,
        FormData:class {constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/kpi-kanban-board.js'),'utf8'),context);
    const board=window.KpiKanbanBoard;
    return {board,window,element,calls,notices,changed,tasks,setIdentity:patch=>{identity={...identity,...patch};},
        submit:code=>({preventDefault(){},target:{values:{taskCode:code},querySelectorAll:()=>[]}}),
        open:()=>board.openTask('SYNTHETIC')};
}
function writes(ui,action){return ui.calls.filter(call=>call.action===action);}

test('default views omit archives and Cancelled while explicit manager archive reads all months',async()=>{
    const archived=row({actionId:'ARCHIVE',taskCode:'ARCHIVE',isArchived:true,resolutionDate:'2026-01-01T00:00:00Z'});
    const ui=setup([row(),archived,row({actionId:'CANCELLED',status:'Cancelled'})]);
    await ui.board.loadKanbanBoard();ui.board.setMonth('all');
    assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/openTask\(&quot;AKRA::(?:ARCHIVE|CANCELLED)/);
    assert.equal(writes(ui,'read')[0].payload.includeArchived,false);
    await ui.board.setView('archive');
    assert.match(ui.element('kb-board-content').innerHTML,/AKRA::ARCHIVE/);
    assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/AKRA::SYNTHETIC/);
    assert.equal(writes(ui,'read').at(-1).payload.includeArchived,true);
    assert.equal(ui.element('kb-month-filter').disabled,true);
    await ui.board.setView('board');assert.equal(writes(ui,'read').at(-1).payload.includeArchived,false);
});

test('archive and restore send immutable identity/revision and preserve task content/status/dates',async()=>{
    const original=row(),ui=setup([original]);await ui.board.loadKanbanBoard();ui.open();await ui.board.setTaskArchived(true);
    assert.deepEqual(writes(ui,'archive')[0].payload,{branch:'AKRA',actionId:'SYNTHETIC',taskId:uuid,taskCode:'KB-SYNTHETIC',expectedRevision:7,archived:true});
    const archived=ui.changed.at(-1);assert.equal(archived.isArchived,true);assert.equal(archived.rawStatus,'Resolved');
    for(const key of ['createdDate','resolutionDate'])assert.equal(archived[key],original[key]);
    assert.deepEqual(clone(archived.checklist),original.checklist);assert.deepEqual(clone(archived.comments),original.comments);
    ui.open();await ui.board.setTaskArchived(false);assert.equal(writes(ui,'archive').at(-1).payload.expectedRevision,8);
    assert.equal(ui.changed.at(-1).isArchived,false);
});

test('archived tasks reject ordinary checklist/comment/image edits and render disabled fields',async()=>{
    const ui=setup([row({isArchived:true,status:'Cancelled'})]);await ui.board.loadKanbanBoard();await ui.board.setView('archive');ui.open();
    assert.match(ui.element('kpi-task-drawer').innerHTML,/<fieldset disabled/);
    assert.match(ui.element('kpi-task-drawer').innerHTML,/ยกเลิกแล้ว/);
    await ui.board.toggleChecklist(0,false);
    await ui.board.addComment({preventDefault(){},target:{querySelector:()=>({value:'Do not write'})}});
    await ui.board.removeImage('image');assert.equal(writes(ui,'save').length,0);
});

test('ordinary payload retains UUID, task code and archive flag',async()=>{
    const ui=setup();await ui.board.loadKanbanBoard();ui.open();await ui.board.toggleChecklist(0,false);
    const payload=writes(ui,'save')[0].payload;assert.equal(payload.id,uuid);assert.equal(payload.taskCode,'KB-SYNTHETIC');assert.equal(payload.isArchived,false);assert.equal(payload.status,'Resolved');
});

test('own-update permission cannot archive, permanently delete or read archive view',async()=>{
    const ui=setup([row()],{identity:{roles:['AKRA'],can:permission=>permission==='updateOwnTasks'}});
    await ui.board.loadKanbanBoard();ui.open();await ui.board.setTaskArchived(true);ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));await ui.board.setView('archive');
    assert.equal(writes(ui,'archive').length+writes(ui,'delete').length,0);assert.equal(writes(ui,'read').length,1);
    assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/ลบงานถาวร|คืนงานเข้าบอร์ด/);
});

test('typed code must match exactly before deletion; completion removes only exact task',async()=>{
    const ui=setup([row(),row({id:'33333333-3333-4333-8333-333333333333',actionId:'KEEP',taskCode:'KEEP'})]);
    await ui.board.loadKanbanBoard();ui.board.setMonth('all');ui.open();ui.board.openDeleteTask();
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC '));assert.equal(writes(ui,'delete').length,0);
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));assert.equal(writes(ui,'delete').length,1);
    const payload=writes(ui,'delete')[0].payload;assert.match(payload.requestId,/^[0-9a-f-]{36}$/);
    assert.equal(payload.taskId,uuid);assert.equal(payload.expectedRevision,7);
    assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/AKRA::SYNTHETIC/);assert.match(ui.element('kb-board-content').innerHTML,/AKRA::KEEP/);
    assert.equal(ui.changed.at(-1).deleted,true);
});

test('unknown delete outcome reads exact receipt and completed readback never repeats deletion',async()=>{
    const ui=setup([row()],{delete:async()=>{throw Error('network unknown');},receipt:payload=>({status:'success',...payload,state:'completed'})});
    await ui.board.loadKanbanBoard();ui.open();ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete').length,1);assert.deepEqual(writes(ui,'receipt')[0].payload,writes(ui,'delete')[0].payload);
    assert.equal(ui.changed.at(-1).deleted,true);
});

test('pending deletion locks edits/archive/restore and explicit retry first reads receipt with same request',async()=>{
    const ui=setup([row()],{delete:payload=>({status:'success',...payload,state:'pending',deleted:false}),receipt:payload=>({status:'success',...payload,state:'pending'})});
    await ui.board.loadKanbanBoard();ui.open();ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete').length,1);assert.match(ui.element('kpi-task-drawer').innerHTML,/ยังลบไม่ครบ/);
    await ui.board.toggleChecklist(0,false);await ui.board.setTaskArchived(true);assert.equal(writes(ui,'save').length+writes(ui,'archive').length,0);
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.deepEqual(writes(ui,'delete')[1].payload,writes(ui,'delete')[0].payload);
    assert.deepEqual(ui.calls.slice(-2).map(call=>call.action),['receipt','delete']);
});

test('unknown result with unavailable receipt does not auto-retry and refuses retry until exact receipt succeeds',async()=>{
    const ui=setup([row()],{delete:async()=>{throw Error('unknown');},receipt:async()=>{throw Error('offline');}});
    await ui.board.loadKanbanBoard();ui.open();ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete').length,1);await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));assert.equal(writes(ui,'delete').length,1);
    ui.window.AkraSupabaseKPI.getKanbanTaskDeletion=async(_token,payload)=>({status:'success',...payload,state:'not_started'});
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));assert.equal(writes(ui,'delete').length,2);
    assert.deepEqual(writes(ui,'delete')[1].payload,writes(ui,'delete')[0].payload);
});

test('proven not-started request conflicting with a newer revision unlocks only after reload and fresh typed confirmation',async()=>{
    let attempt=0;
    const ui=setup([row()],{delete:async(payload,tasks)=>{
        if(++attempt===1)throw Error('unknown before begin');
        if(payload.expectedRevision!==tasks[0].revision)throw Object.assign(Error('stale'),{reason:'record_conflict'});
        return {status:'success',...payload,state:'completed',deleted:true};
    },receipt:payload=>({status:'success',...payload,state:'not_started'})});
    await ui.board.loadKanbanBoard();ui.open();ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.match(ui.element('kpi-task-drawer').innerHTML,/ยังไม่ได้เริ่มลบงาน/);
    ui.tasks[0].revision=8;
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete').length,2,'conflict reload never automatically creates a replacement request');
    assert.deepEqual(writes(ui,'delete')[1].payload,writes(ui,'delete')[0].payload,'the failed retry still uses its original request');
    ui.open();assert.equal(ui.element('kpi-task-drawer').innerHTML.includes('<fieldset disabled'),false,'canonical task becomes editable after confirmed no-intent conflict');
    ui.board.openDeleteTask();assert.match(ui.element('kpi-task-drawer').innerHTML,/ยืนยันลบงานถาวร/);
    assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/ลองลบด้วยคำขอเดิม/);
    await ui.board.handleDeleteTask(ui.submit('wrong'));assert.equal(writes(ui,'delete').length,2,'a new attempt requires a fresh exact typed code');
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete').length,3);assert.equal(writes(ui,'delete')[2].payload.expectedRevision,8);
    assert.notEqual(writes(ui,'delete')[2].payload.requestId,writes(ui,'delete')[0].payload.requestId);
    assert.equal(ui.changed.at(-1).deleted,true);
});

test('conflicted receipt readback preserves pending or unknown request instead of treating historical not-started as current proof',async()=>{
    for(const state of ['pending','unknown','not_started']){
        let receiptRead=0,attempt=0;
        const ui=setup([row()],{delete:async payload=>{
            attempt++;
            if(state!=='pending')throw Error('unknown before begin');
            return {status:'success',...payload,state:'pending',deleted:false};
        },receipt:payload=>{
            receiptRead++;
            if(receiptRead>1||state==='unknown')throw Object.assign(Error('conflicted receipt'),{reason:'record_conflict'});
            return {status:'success',...payload,state};
        }});
        await ui.board.loadKanbanBoard();ui.open();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
        if(state==='pending')await ui.board.reconcileTaskDeletion();
        await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
        assert.equal(attempt,1,'receipt conflict cannot dispatch another deletion');
        ui.open();assert.equal(ui.element('kpi-task-drawer').innerHTML.includes('<fieldset disabled'),true,state+' request remains locked until canonical outcome is known');
        ui.board.openDeleteTask();assert.match(ui.element('kpi-task-drawer').innerHTML,/ลองลบด้วยคำขอเดิม/);
    }
});

test('canonical pending projection resumes original request/revision after full reload and reconfirms task code',async()=>{
    const ui=setup([row({revision:9,deletionPending:true,deletionRequestId:requestUuid,deletionExpectedRevision:7})],{receipt:payload=>({status:'success',...payload,state:'pending'})});
    await ui.board.loadKanbanBoard();ui.open();assert.match(ui.element('kpi-task-drawer').innerHTML,/<fieldset disabled/);
    ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('wrong'));assert.equal(writes(ui,'receipt').length,0);
    await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete')[0].payload.requestId,requestUuid);assert.equal(writes(ui,'delete')[0].payload.expectedRevision,7);
    assert.deepEqual(ui.calls.slice(-2).map(call=>call.action),['receipt','delete']);
});

test('mismatched receipt cannot complete another task or permit a retry',async()=>{
    const ui=setup([row()],{delete:async()=>{throw Error('unknown');},receipt:payload=>({status:'success',...payload,taskId:'other',state:'completed'})});
    await ui.board.loadKanbanBoard();ui.open();ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(ui.changed.length,0);await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));assert.equal(writes(ui,'delete').length,1);
});

test('server image-upload denial leaves ordinary task editable and does not report deletion',async()=>{
    const ui=setup([row()],{delete:async()=>{throw Object.assign(Error('image pending'),{reason:'image_upload_pending'});}});
    await ui.board.loadKanbanBoard();ui.open();ui.board.openDeleteTask();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'receipt').length,0);assert.ok(ui.notices.some(message=>/อัปโหลดรูป/.test(message)));
    await ui.board.toggleChecklist(0,false);assert.equal(writes(ui,'save').length,1);assert.equal(ui.changed[0].deleted,undefined);
});

test('disabled deletion route creates no pending intent, changes no task data and keeps ordinary editing available',async()=>{
    const ui=setup([row()],{delete:async()=>{throw Object.assign(Error('not ready'),{reason:'task_delete_not_ready'});}}),before=JSON.stringify(ui.tasks);
    await ui.board.loadKanbanBoard();ui.open();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'delete').length,1);assert.equal(writes(ui,'receipt').length,0,'known readiness denial is not an unknown deletion outcome');
    assert.equal(JSON.stringify(ui.tasks),before);assert.equal(ui.changed.length,0,'readiness denial cannot report a deletion or mutate another task');
    assert.ok(ui.notices.some(message=>message==='ระบบลบงานยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง'));
    ui.open();assert.equal(ui.element('kpi-task-drawer').innerHTML.includes('<fieldset disabled'),false);
    await ui.board.toggleChecklist(0,false);assert.equal(writes(ui,'save').length,1);assert.equal(ui.changed.at(-1).deleted,undefined);
    ui.board.openDeleteTask();assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/ลองลบด้วยคำขอเดิม/);
});

test('readiness denial preserves an existing pending receipt and clears only a retry just proven not started',async()=>{
    for(const previous of ['pending','unknown','not_started']){
        let attempt=0,receiptReads=0;
        const ui=setup([row()],{delete:async payload=>{
            if(++attempt>1)throw Object.assign(Error('not ready'),{reason:'task_delete_not_ready'});
            if(previous!=='pending')throw Error('unknown initial outcome');
            return {status:'success',...payload,state:'pending',deleted:false};
        },receipt:payload=>{
            if(++receiptReads===1&&previous==='unknown')throw Error('receipt temporarily unavailable');
            return {status:'success',...payload,state:previous==='not_started'?'not_started':'pending'};
        }});
        await ui.board.loadKanbanBoard();ui.open();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
        await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
        assert.equal(attempt,2);assert.deepEqual(writes(ui,'delete')[1].payload,writes(ui,'delete')[0].payload);
        assert.deepEqual(ui.calls.slice(-2).map(call=>call.action),['receipt','delete'],'readiness denial does not replace a just-read canonical receipt');
        assert.equal(ui.changed.length,0);assert.ok(ui.notices.some(message=>/^ระบบลบงานยังไม่พร้อมใช้งาน/.test(message)));
        ui.open();assert.equal(ui.element('kpi-task-drawer').innerHTML.includes('<fieldset disabled'),previous!=='not_started');
        if(previous==='not_started'){
            await ui.board.toggleChecklist(0,false);assert.equal(writes(ui,'save').length,1);
        }else{
            await ui.board.toggleChecklist(0,false);await ui.board.setTaskArchived(false);assert.equal(writes(ui,'save').length+writes(ui,'archive').length,0);
            ui.board.openDeleteTask();await ui.board.reconcileTaskDeletion();
            assert.match(ui.element('kpi-task-drawer').innerHTML,/ยังลบไม่ครบ/,'getter remains usable while deletion is disabled');
            await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
            assert.deepEqual(writes(ui,'delete')[2].payload,writes(ui,'delete')[0].payload,'pending request identity is never regenerated or rebased');
        }
    }
});

test('known stale-revision denial reloads canonical task and leaves no invented deletion receipt',async()=>{
    const ui=setup([row()],{delete:async()=>{throw Object.assign(Error('stale'),{reason:'record_conflict'});}});
    await ui.board.loadKanbanBoard();ui.open();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
    assert.equal(writes(ui,'receipt').length,0);assert.equal(writes(ui,'read').length,2);
    ui.open();await ui.board.toggleChecklist(0,false);assert.equal(writes(ui,'save').length,1);
});

test('explicit invalidation clears private drawer, cached task data and unresolved request memory',async()=>{
    const ui=setup([row()],{delete:payload=>({status:'success',...payload,state:'pending',deleted:false})});
    await ui.board.loadKanbanBoard();ui.open();await ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));ui.board.invalidate();
    assert.equal(ui.element('kpi-task-drawer').innerHTML,'');assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/KB-SYNTHETIC/);
    await ui.board.loadKanbanBoard();ui.open();await ui.board.toggleChecklist(0,false);assert.equal(writes(ui,'save').length,1);
});

test('late lifecycle response cannot change replaced identity or selected scope',async()=>{
    for(const change of ['identity','reload','scope'])for(const action of ['archive','delete']){
        let finish;const ui=setup([row()],{[action]:payload=>new Promise(resolve=>finish=()=>resolve(action==='archive'?{status:'success',task:row({isArchived:true})}:{status:'success',...payload,deleted:true}))});
        await ui.board.loadKanbanBoard();ui.open();
        const pending=action==='archive'?ui.board.setTaskArchived(true):ui.board.handleDeleteTask(ui.submit('KB-SYNTHETIC'));
        await drain();if(change==='identity')ui.setIdentity({token:'replacement',branch:'TRD',userUid:'two'});
        await ui.board.loadKanbanBoard();if(change==='scope')await ui.board.setBranchScope('TRD');finish();await pending;
        assert.equal(ui.changed.length,0);assert.doesNotMatch(ui.element('kpi-task-drawer').innerHTML,/KB-SYNTHETIC/);
        assert.equal(writes(ui,'receipt').length,0);
    }
});

function setupClient(respond) {
    let owner={},token='synthetic';const calls=[];
    const window={getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>token};
    const context=vm.createContext({window,self:window,console,AbortController,setTimeout,clearTimeout,fetch:async(_url,options)=>{
        const payload=JSON.parse(options.body);calls.push(payload);return {ok:true,json:async()=>respond(payload)};
    }});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8'),context);
    return {client:window.AkraSupabaseKPI,calls,replaceOwner:()=>{owner={};}};
}
const identity={branch:'AKRA',actionId:'SYNTHETIC',taskId:uuid,taskCode:'KB-SYNTHETIC',expectedRevision:7,requestId:requestUuid};
test('real client sends exact lifecycle payload through signed KPI endpoint and validates response identity',async()=>{
    const ui=setupClient(payload=>payload.action==='setKanbanTaskArchived'?{status:'success',task:row({isArchived:true})}:{status:'success',...payload,state:'pending',deleted:false});
    await ui.client.setKanbanTaskArchived('synthetic',{...identity,archived:true});
    await ui.client.deleteKanbanTask('synthetic',identity);await ui.client.getKanbanTaskDeletion('synthetic',identity);
    assert.deepEqual(ui.calls.map(call=>call.action),['setKanbanTaskArchived','deleteKanbanTask','getKanbanTaskDeletion']);
    assert.equal(ui.calls[1].token,'synthetic');assert.equal(ui.calls[2].requestId,requestUuid);
    const wrong=setupClient(payload=>({status:'success',...payload,taskId:'wrong',state:'completed',deleted:true}));
    await assert.rejects(wrong.client.deleteKanbanTask('synthetic',identity),/invalid_kanban_delete_response/);
    await assert.rejects(wrong.client.getKanbanTaskDeletion('synthetic',identity),/invalid_kanban_delete_receipt/);
});
test('client discards delayed deletion receipt after session owner changes',async()=>{
    let finish;const ui=setupClient(payload=>new Promise(resolve=>finish=()=>resolve({status:'success',...payload,state:'completed'})));
    const pending=ui.client.getKanbanTaskDeletion('synthetic',identity);await drain();ui.replaceOwner();finish();await assert.rejects(pending,/session_changed/);
});
