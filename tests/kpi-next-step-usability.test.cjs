// Isolated actual-controller fixtures: no network, production state, or filesystem writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(tasks = [], options = {}) {
    const elements = new Map(), writes = [], notices = [], dropHandlers = {};
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, {innerHTML:'',textContent:'',value:'',attributes:{},
                classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},
                    toggle(name,force){const enabled=force??!classes.has(name);if(enabled)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
                setAttribute(name,value){this.attributes[name]=value;},focus(){},addEventListener(){},querySelectorAll:()=>[]});
        }
        return elements.get(id);
    };
    const column = {dataset:{dropStatus:options.dropStatus||'progress'},classList:{add(){},remove(){}},addEventListener:(name,handler)=>dropHandlers[name]=handler};
    const document = {getElementById:element,addEventListener(){},querySelectorAll:selector=>selector==='.column[data-drop-status]'?[column]:[],body:{style:{}}};
    const window = {getTodayBangkokDateStr:()=> '2026-10-02',showToast:message=>notices.push(message),
        getKpiTaskContext:()=>({token:'synthetic',branch:'AKRA',userUid:'u1',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],can:()=>options.canEdit!==false}),
        AkraSupabaseKPI:{getKanbanBoard:async(_token,branch)=>({tasks:tasks.filter(task=>(task.branch||'AKRA')===branch),employees:[{employeeUid:'u1',name:'One'},{employeeUid:'u2',name:'Two'}],issueIntegrationReady:false}),
            saveKanbanTask:async(_token,payload,revision)=>{writes.push({payload,revision});const index=tasks.findIndex(task=>task.actionId===payload.actionId && (task.branch||'AKRA')===payload.branch);
                const saved={...payload,revision:revision+1};if(index<0)tasks.push(saved);else tasks[index]=saved;return {task:saved};}}};
    const context=vm.createContext({window,document,console,Intl,Date,Math,crypto:require('node:crypto').webcrypto,
        FormData:class {constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/kpi-kanban-board.js'),'utf8'),context);
    const submit = values=>({preventDefault(){},target:{values}});
    return {window,element,writes,notices,dropHandlers,submit,tasks};
}
const task = extra=>({actionId:'TASK-1',title:'Synthetic task',ownerUid:'u1',status:'In Progress',dueDate:'2026-10-08',nextStep:'รอเริ่มดำเนินงาน',revision:4,checklist:[{id:'c1',text:'Existing',done:false}],comments:[],...extra});

test('legacy placeholder is shown as missing on board/list without rewriting stored task',async()=>{
    const ui=setup([task()]);await ui.window.KpiKanbanBoard.loadKanbanBoard();
    assert.match(ui.element('kb-board-content').innerHTML,/ยังไม่ระบุขั้นถัดไป/);
    assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/รอเริ่มดำเนินงาน/);
    ui.window.KpiKanbanBoard.setView('list');assert.match(ui.element('kb-board-content').innerHTML,/ยังไม่ระบุขั้นถัดไป/);
    assert.equal(ui.tasks[0].nextStep,'รอเริ่มดำเนินงาน');assert.equal(ui.writes.length,0);
});

test('progress and blocked edits reject empty/default next steps; explicit action/date preserves task due date',async()=>{
    const ui=setup([task()]);await ui.window.KpiKanbanBoard.loadKanbanBoard();
    const values={owner:'u1',due:'2026-10-08',status:'progress',next:'',blocked:'',note:''};
    for(const status of ['progress','blocked'])for(const next of ['', '  รอเริ่มดำเนินงาน  ', 'ดำเนินการตามแผน']) {
        ui.window.KpiKanbanBoard.openTask('TASK-1');await ui.window.KpiKanbanBoard.handleSaveTask(ui.submit({...values,status,next,blocked:status==='blocked'?'Waiting supplier':''}));
        assert.equal(ui.writes.length,0);assert.match(ui.element('kb-form-error').textContent,/ขั้นถัดไป/);
    }
    ui.window.KpiKanbanBoard.openTask('TASK-1');
    await ui.window.KpiKanbanBoard.handleSaveTask(ui.submit({...values,status:'blocked',next:'  โทรตามผู้ขาย 3 ต.ค.  ',blocked:'Waiting supplier'}));
    assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].revision,4);assert.equal(ui.writes[0].payload.nextStep,'โทรตามผู้ขาย 3 ต.ค.');
    assert.equal(ui.writes[0].payload.dueDate,'2026-10-08');assert.equal(ui.writes[0].payload.status,'Blocked');
    assert.equal(ui.writes[0].payload.checklist[0].id,'c1');assert.equal(ui.writes[0].payload.checklist[0].done,false);
});

test('new open tasks do not fabricate next steps, while new progress tasks require one',async()=>{
    const ui=setup();await ui.window.KpiKanbanBoard.loadKanbanBoard();
    const values={branch:'AKRA',owner:'u1',title:'Create synthetic',status:'progress',next:'',due:'2026-10-08',category:'คลังสินค้า',priority:'normal'};
    ui.window.KpiKanbanBoard.openNewTaskModal('progress');await ui.window.KpiKanbanBoard.handleCreateTask(ui.submit(values));
    assert.equal(ui.writes.length,0);assert.match(ui.element('kb-create-form-error').textContent,/ขั้นถัดไป/);
    await ui.window.KpiKanbanBoard.handleCreateTask(ui.submit({...values,next:'ตรวจของ 3 ต.ค.'}));assert.equal(ui.writes.length,1);
    await ui.window.KpiKanbanBoard.handleCreateTask(ui.submit({...values,status:'open',next:''}));assert.equal(ui.writes.length,2);
    assert.equal(ui.writes[1].payload.nextStep,'');assert.equal(ui.writes[1].payload.status,'Open');
});

test('dragging into progress or blocked opens the edit form before writing a missing next step',async()=>{
    for(const status of ['progress','blocked']) {
        const ui=setup([task({status:'Open',blockedReason:'Known wait'})],{dropStatus:status});await ui.window.KpiKanbanBoard.loadKanbanBoard();
        await ui.dropHandlers.drop({preventDefault(){},dataTransfer:{getData:()=> 'AKRA::TASK-1'}});
        assert.equal(ui.writes.length,0);assert.match(ui.element('kpi-task-drawer').innerHTML,new RegExp('value="'+status+'" selected'));
        assert.ok(ui.notices.some(message=>message.includes('ขั้นถัดไป')));
    }
});

test('done requires outcome but legacy checklist/comment updates do not require an unrelated next-step edit',async()=>{
    const ui=setup([task()]);await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask('TASK-1');
    await ui.window.KpiKanbanBoard.toggleChecklist(0,true);assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].payload.nextStep,'รอเริ่มดำเนินงาน');
    await ui.window.KpiKanbanBoard.addComment({preventDefault(){},target:{querySelector:()=>({value:'Synthetic comment'})}});assert.equal(ui.writes.length,2);
    ui.window.KpiKanbanBoard.openTask('TASK-1');await ui.window.KpiKanbanBoard.handleSaveTask(ui.submit({owner:'u1',due:'2026-10-08',status:'done',next:'',note:''}));assert.equal(ui.writes.length,2);
    await ui.window.KpiKanbanBoard.handleSaveTask(ui.submit({owner:'u1',due:'2026-10-08',status:'done',next:'',note:'Finished fixture'}));assert.equal(ui.writes.length,3);assert.equal(ui.writes[2].payload.status,'Resolved');
});

test('blocked quick filter composes with overdue/My Tasks/combined branches and remains read-only',async()=>{
    const ui=setup([
        task({actionId:'A-MINE',title:'Mine overdue blocked',status:'Blocked',dueDate:'2026-10-01'}),
        task({actionId:'A-OTHER',title:'Other blocked',ownerUid:'u2',status:'Blocked',dueDate:'2026-10-08'}),
        task({actionId:'A-PROGRESS',title:'Active progress',status:'In Progress',dueDate:'2026-10-01'}),
        task({actionId:'T-MINE',title:'TRD mine blocked',branch:'TRD',status:'Blocked',dueDate:'2026-10-01'})
    ]);
    await ui.window.KpiKanbanBoard.setBranchScope('ALL');ui.window.KpiKanbanBoard.setView('mine');ui.window.KpiKanbanBoard.toggleBlocked();
    assert.match(ui.element('kb-board-content').innerHTML,/Mine overdue blocked/);assert.match(ui.element('kb-board-content').innerHTML,/TRD mine blocked/);
    assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/Other blocked|Active progress/);assert.equal(ui.element('kb-blocked-count').textContent,3);
    assert.equal(ui.element('kb-blocked-toggle').attributes['aria-pressed'],'true');
    ui.window.KpiKanbanBoard.toggleOverdue();assert.match(ui.element('kb-board-content').innerHTML,/Mine overdue blocked/);
    assert.equal(ui.element('kb-overdue-toggle').attributes['aria-pressed'],'true');
    ui.window.KpiKanbanBoard.toggleBlocked();assert.match(ui.element('kb-board-content').innerHTML,/Active progress/);assert.equal(ui.writes.length,0);
});

test('view-only task edits remain denied and changing status updates next-step required state',async()=>{
    const ui=setup([task()],{canEdit:false});await ui.window.KpiKanbanBoard.loadKanbanBoard();ui.window.KpiKanbanBoard.openTask('TASK-1');
    await ui.window.KpiKanbanBoard.handleSaveTask(ui.submit({owner:'u1',due:'2026-10-08',status:'progress',next:'ตรวจของ 3 ต.ค.'}));assert.equal(ui.writes.length,0);
    ui.window.KpiKanbanBoard.handleStatusFieldChange('blocked');assert.equal(ui.element('kb-next-input').required,true);
    ui.window.KpiKanbanBoard.handleStatusFieldChange('done');assert.equal(ui.element('kb-next-input').required,false);
});
