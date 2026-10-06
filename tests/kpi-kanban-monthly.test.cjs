// Actual controller in an isolated VM. All records, time and API responses are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

const row = (id, extra = {}) => ({actionId:id,branch:'AKRA',title:'Task '+id,ownerUid:'u1',owner:'One',
    status:'Open',category:'Warehouse',createdDate:'2026-10-02T01:00:00Z',resolutionDate:null,
    dueDate:'2026-10-10',revision:1,checklist:[{id:'check',text:'Check',done:false}],comments:[],attachments:[],...extra});

function setup(tasks = [], options = {}) {
    let now = Date.parse(options.now || '2026-10-06T05:00:00Z');
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const elements = new Map(), reads = [], writes = [], notices = [], changed = [], dropHandlers = {};
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id,{innerHTML:'',textContent:'',value:'',checked:false,disabled:false,attributes:{},handlers:{},
                classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},
                    contains:value=>classes.has(value),toggle(value,force){const enabled=force??!classes.has(value);if(enabled)classes.add(value);else classes.delete(value);}},
                addEventListener(name,callback){this.handlers[name]=callback;},setAttribute(name,value){this.attributes[name]=value;},
                focus(){},querySelectorAll:()=>[],querySelector:()=>null});
        }
        return elements.get(id);
    };
    let identity = {token:'synthetic',branch:'AKRA',userUid:'u1',name:'One',roles:['ADMIN'],allowedBranches:['AKRA','TRD'],
        employees:[],can:()=>true,...options.identity};
    const employees = [{employeeUid:'u1',name:'One'},{employeeUid:'u2',name:'Two'}];
    const api = {
        getKanbanBoard:async(token,branch)=>{
            reads.push({token,branch});
            if (options.read) return options.read(token,branch);
            return {status:'success',tasks:tasks.filter(task=>task.branch===branch),employees,issueIntegrationReady:false};
        },
        saveKanbanTask:async(token,payload,revision)=>{
            writes.push({token,payload,revision});
            const saved = options.save ? await options.save(payload,revision) : {...payload,revision:revision+1,
                createdDate:new ClockDate().toISOString(),resolutionDate:payload.status==='Resolved'?new ClockDate().toISOString():null};
            const index=tasks.findIndex(task=>task.actionId===saved.actionId&&task.branch===saved.branch);
            if(index<0)tasks.push(saved);else tasks[index]=saved;
            return {status:'success',task:saved};
        },
        ...options.api
    };
    const window = {AkraSupabaseKPI:api,getKpiTaskContext:()=>identity,showToast:message=>notices.push(message),
        getTodayBangkokDateStr:()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new ClockDate()),
        onKpiTaskChanged:task=>changed.push(task),confirm:()=>true};
    const dropColumn={dataset:{dropStatus:options.dropStatus},classList:{add(){},remove(){}},addEventListener:(event,callback)=>{dropHandlers[event]=callback;}};
    const document={getElementById:element,querySelectorAll:selector=>options.dropStatus&&selector==='.column[data-drop-status]'?[dropColumn]:[],addEventListener(){},body:{style:{}}};
    const context=vm.createContext({window,document,console,Intl,Date:ClockDate,Math,structuredClone,crypto:webcrypto,
        FormData:class {constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/kpi-kanban-board.js'),'utf8'),context);
    window.KpiKanbanBoard.initEventListeners();
    return {window,board:window.KpiKanbanBoard,element,document,reads,writes,notices,changed,tasks,dropHandlers,
        setNow:value=>{now=Date.parse(value);},setIdentity:value=>{identity={...identity,...value};},
        filter(id,value){element(id).handlers[id==='kb-search'?'input':'change']({target:{value}});},
        submit:values=>({preventDefault(){},target:{values}})};
}

function visible(ui) {
    const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    return [...ui.element('kb-board-content').innerHTML.matchAll(/window\.KpiKanbanBoard\.openTask\((.*?)\)/g)]
        .map(match=>JSON.parse(decode(match[1]))).sort();
}
function expectVisible(ui, ids) { assert.deepEqual(visible(ui),ids.map(id=>id.includes('::')?id:'AKRA::'+id).sort()); }
function summaryCount(ui,count) { assert.match(ui.element('kb-summary').textContent,new RegExp('^'+count+' งาน(?: |$)')); }
function expectColumns(ui,counts) {
    const html=ui.element('kb-board-content').innerHTML;
    for(const status of ['open','progress','blocked','done']) {
        const match=html.match(new RegExp('data-drop-status="'+status+'"[\\s\\S]*?font-num">(\\d+)</span>'));
        assert.ok(match,'rendered '+status+' column count');assert.equal(Number(match[1]),counts[status]||0,status+' count equals its visible cards');
    }
}
const drain=()=>new Promise(resolve=>setImmediate(resolve));

test('current month uses creation for unfinished work and closure for completed work in all views',async()=>{
    const tasks=[row('SEPT-OPEN',{createdDate:'2026-09-12T00:00:00Z'}),row('OCT-OPEN'),
        row('OCT-CLOSED',{status:'Resolved',createdDate:'2026-08-01T00:00:00Z',resolutionDate:'2026-10-01T01:00:00Z'}),
        row('SEPT-CLOSED',{status:'Completed',resolutionDate:'2026-09-30T16:59:59Z'}),
        row('FUTURE',{createdDate:'2026-11-01T00:00:00Z'}),row('ARCHIVED',{isArchived:true}),row('CANCELLED',{status:'Cancelled'})];
    const before=JSON.stringify(tasks),ui=setup(tasks);await ui.board.loadKanbanBoard();
    assert.equal(ui.element('kb-month-filter').value,'current');assert.equal(ui.element('kb-carryover').checked,true);
    assert.equal(ui.element('kb-carryover').disabled,false);expectColumns(ui,{open:2,done:1});
    for(const view of ['board','list','mine']) {
        ui.board.setView(view);expectVisible(ui,['SEPT-OPEN','OCT-OPEN','OCT-CLOSED']);summaryCount(ui,3);
        assert.match(ui.element('kb-board-content').innerHTML,/ค้างจาก/);
    }
    ui.board.setCarryover(false);expectVisible(ui,['OCT-OPEN','OCT-CLOSED']);summaryCount(ui,2);
    ui.board.setMonth('2026-09');expectVisible(ui,['SEPT-OPEN','SEPT-CLOSED']);
    ui.board.setMonth('all');expectVisible(ui,['SEPT-OPEN','OCT-OPEN','OCT-CLOSED','SEPT-CLOSED','FUTURE']);
    assert.equal(ui.element('kb-carryover').disabled,true);
    assert.equal(ui.reads.length,1,'month/view filters use the complete cached read');assert.equal(ui.writes.length,0);assert.equal(JSON.stringify(tasks),before);
});

test('carryover follows the selected historical month and selector includes empty months',async()=>{
    const ui=setup([row('JULY',{createdDate:'2026-07-01T00:00:00Z'}),row('SEPT',{createdDate:'2026-09-10T00:00:00Z'}),row('OCT')]);
    await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');expectVisible(ui,['JULY','SEPT']);
    assert.match(ui.element('kb-month-filter').innerHTML,/value="2026-08"/);
    ui.board.setCarryover(false);expectVisible(ui,['SEPT']);
    ui.board.setMonth('2026-08');expectVisible(ui,[]);summaryCount(ui,0);
    ui.board.setCarryover(true);expectVisible(ui,['JULY']);
    assert.match(ui.element('kb-summary').textContent,/ค้างจากเดือนก่อน 1 งาน/);assert.match(ui.element('kb-board-content').innerHTML,/ค้างจาก/);
    assert.equal(ui.reads.length,1);assert.equal(ui.writes.length,0);
});

test('Bangkok midnight determines month membership independently of host timezone and task hints',async()=>{
    const ui=setup([
        row('BEFORE',{createdDate:'2026-09-30T16:59:59Z'}),row('AT',{createdDate:'2026-09-30T17:00:00Z'}),
        row('OFFSET',{createdDate:'2026-10-01T00:00:00+07:00'}),
        row('DATE-ONLY',{createdDate:'2026-10-01'}),
        row('CLOSED-BEFORE',{status:'Resolved',resolutionDate:'2026-09-30T16:59:59Z'}),
        row('CLOSED-AT',{status:'Resolved',resolutionDate:'2026-09-30T17:00:00Z'}),
        row('MISLEADING',{status:'Resolved',createdDate:'2026-10-03T00:00:00Z',resolutionDate:'2026-08-02T00:00:00Z',
            dueDate:'2026-10-06',taskCode:'KB-1020269999',sourceDate:'2026-10-01',lastUpdated:'2026-10-06T00:00:00Z'})]);
    await ui.board.loadKanbanBoard();ui.board.setCarryover(false);expectVisible(ui,['AT','OFFSET','DATE-ONLY','CLOSED-AT']);
    ui.board.setMonth('2026-09');expectVisible(ui,['BEFORE','CLOSED-BEFORE']);
});

test('dynamic Current rolls at Bangkok December/January refresh while explicit historical month stays selected',async()=>{
    const ui=setup([row('DEC',{createdDate:'2026-12-31T16:59:59Z'}),row('JAN',{createdDate:'2026-12-31T17:00:00Z'})],{now:'2026-12-31T16:59:59Z'});
    await ui.board.loadKanbanBoard();ui.board.setCarryover(false);expectVisible(ui,['DEC']);
    ui.setNow('2026-12-31T17:00:00Z');await ui.board.loadKanbanBoard();expectVisible(ui,['JAN']);
    assert.equal(ui.element('kb-month-filter').value,'current');
    ui.board.setMonth('2026-12');ui.setNow('2027-02-01T02:00:00Z');await ui.board.loadKanbanBoard();expectVisible(ui,['DEC']);
    assert.equal(ui.element('kb-month-filter').value,'2026-12');
});

test('valid leap day belongs to February; malformed and timezone-free values stay unknown',async()=>{
    const ui=setup([row('LEAP',{createdDate:'2028-02-29T16:59:59Z'}),row('MARCH',{createdDate:'2028-02-29T17:00:00Z'}),
        row('INVALID-LEAP',{status:'Resolved',resolutionDate:'2027-02-29T00:00:00Z'}),
        row('INVALID-DAY',{status:'Resolved',resolutionDate:'2026-02-30T00:00:00Z'}),
        row('INVALID-DATE-ONLY',{status:'Resolved',resolutionDate:'2026-02-30'}),
        row('LOCAL',{status:'Resolved',resolutionDate:'2028-02-10T12:00:00'}),
        row('INVALID',{status:'Resolved',resolutionDate:'garbage'})],{now:'2028-02-10T00:00:00Z'});
    await ui.board.loadKanbanBoard();ui.board.setCarryover(false);expectVisible(ui,['LEAP']);
    ui.board.setMonth('unknown');expectVisible(ui,['INVALID-LEAP','INVALID-DAY','INVALID-DATE-ONLY','LOCAL','INVALID']);
    ui.board.setMonth('2028-03');expectVisible(ui,['MARCH']);
});

test('unknown creation stays visible and unknown closure has explicit access without invented date fallbacks',async()=>{
    const ui=setup([row('MISSING-OPEN',{createdDate:null}),row('BAD-OPEN',{createdDate:'not-a-date'}),
        row('MISSING-CLOSED',{status:'Resolved',resolutionDate:null,dueDate:'2026-10-06',sourceDate:'2026-10-01',lastUpdated:'2026-10-01T00:00:00Z'}),
        row('BAD-CLOSED',{status:'Completed',resolutionDate:'2026-13-01T00:00:00Z'}),row('KNOWN-CLOSED',{status:'Resolved',resolutionDate:'2026-10-05T00:00:00Z'})]);
    await ui.board.loadKanbanBoard();ui.board.setCarryover(false);expectVisible(ui,['MISSING-OPEN','BAD-OPEN','KNOWN-CLOSED']);
    assert.match(ui.element('kb-board-content').innerHTML,/ไม่ระบุวันที่สร้าง/);
    assert.match(ui.element('kb-unknown-closed').textContent,/2/);assert.match(ui.element('kb-month-filter').innerHTML,/value="unknown"/);
    ui.board.setMonth('unknown');expectVisible(ui,['MISSING-CLOSED','BAD-CLOSED']);summaryCount(ui,2);
    assert.equal(ui.element('kb-carryover').disabled,true);
    ui.board.setMonth('all');expectVisible(ui,['MISSING-OPEN','BAD-OPEN','MISSING-CLOSED','BAD-CLOSED','KNOWN-CLOSED']);
    assert.equal(ui.element('kb-carryover').disabled,true);ui.board.setMonth('current');assert.equal(ui.element('kb-carryover').disabled,false);
    assert.equal(ui.writes.length,0);
});

test('Mine/search/category/owner/month compose before blocked and overdue facets and unknown counts',async()=>{
    const ui=setup([
        row('MATCH-BLOCKED',{title:'Needle blocked',status:'Blocked',dueDate:'2026-10-01'}),
        row('MATCH-OPEN',{title:'Needle open',dueDate:'2026-10-01'}),
        row('MATCH-NOT-DUE',{title:'Needle waiting',status:'Blocked',dueDate:'2026-10-20'}),
        row('OTHER',{title:'Needle other',status:'Blocked',ownerUid:'u2',dueDate:'2026-10-01'}),
        row('OTHER-CATEGORY',{title:'Needle category',status:'Blocked',category:'Office',dueDate:'2026-10-01'}),
        row('OTHER-SEARCH',{title:'Different',status:'Blocked',dueDate:'2026-10-01'}),
        row('OLD-CLOSED',{title:'Needle old',status:'Resolved',resolutionDate:'2026-09-01T00:00:00Z'}),
        row('UNKNOWN-MINE',{title:'Needle unknown',status:'Resolved',resolutionDate:null}),
        row('UNKNOWN-OTHER',{title:'Needle unknown other',status:'Resolved',resolutionDate:null,ownerUid:'u2'})]);
    await ui.board.loadKanbanBoard();ui.board.setView('mine');ui.filter('kb-search','needle');ui.filter('kb-filter-category','Warehouse');
    ui.filter('kb-filter-owner','u1');expectVisible(ui,['MATCH-BLOCKED','MATCH-OPEN','MATCH-NOT-DUE']);
    assert.equal(Number(ui.element('kb-blocked-count').textContent),2);assert.equal(Number(ui.element('kb-overdue-count').textContent),2);
    assert.match(ui.element('kb-unknown-closed').textContent,/1/);
    ui.board.toggleBlocked();expectVisible(ui,['MATCH-BLOCKED','MATCH-NOT-DUE']);summaryCount(ui,2);
    ui.board.toggleOverdue();expectVisible(ui,['MATCH-BLOCKED']);summaryCount(ui,1);
    assert.equal(Number(ui.element('kb-blocked-count').textContent),2,'blocked facet excludes both quick toggles');
    assert.equal(Number(ui.element('kb-overdue-count').textContent),2,'overdue facet excludes both quick toggles');
    assert.equal(ui.element('kb-unknown-closed').classList.contains('hidden'),true,'unknown completed count respects status filters');
    ui.board.toggleBlocked();expectVisible(ui,['MATCH-BLOCKED','MATCH-OPEN']);ui.board.toggleOverdue();
    ui.board.setView('list');expectVisible(ui,['MATCH-BLOCKED','MATCH-OPEN','MATCH-NOT-DUE']);assert.equal(ui.writes.length,0);
});

test('monthly preference survives view, authorized scope and same-user token refresh but resets for replacement identity',async()=>{
    const ui=setup([row('AKRA-SEPT',{createdDate:'2026-09-05T00:00:00Z'}),row('TRD-SEPT',{branch:'TRD',createdDate:'2026-09-05T00:00:00Z'}),row('OCT')]);
    await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');ui.board.setCarryover(false);ui.board.setView('list');
    await ui.board.setBranchScope('ALL');expectVisible(ui,['AKRA-SEPT','TRD::TRD-SEPT']);
    assert.equal(ui.element('kb-month-filter').value,'2026-09');assert.equal(ui.element('kb-carryover').checked,false);
    ui.setIdentity({token:'rotated-same-user'});await ui.board.loadKanbanBoard();expectVisible(ui,['AKRA-SEPT','TRD::TRD-SEPT']);
    assert.equal(ui.element('kb-month-filter').value,'2026-09');
    ui.setIdentity({token:'different-user',userUid:'u2',name:'Two'});await ui.board.loadKanbanBoard();
    assert.equal(ui.element('kb-month-filter').value,'current');assert.equal(ui.element('kb-carryover').checked,true);
});

test('staff month/All controls and Dashboard deep links preserve branch and owner denials',async()=>{
    const ui=setup([row('OLD',{status:'Resolved',resolutionDate:'2026-09-02T00:00:00Z'}),row('OTHER',{ownerUid:'u2'})],
        {identity:{roles:['AKRA'],allowedBranches:['AKRA','TRD'],can:permission=>permission==='updateOwnTasks'}});
    await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');await ui.board.setBranchScope('ALL');await ui.board.setBranchScope('TRD');
    assert.deepEqual(ui.reads.map(read=>read.branch),['AKRA']);
    ui.board.setMonth('current');expectVisible(ui,['OTHER']);
    await ui.board.openFromDashboard('OLD','TRD');assert.equal(ui.reads.length,1);
    await ui.board.openFromDashboard('OLD','AKRA');assert.match(ui.element('kpi-task-drawer').innerHTML,/Task OLD/);
    expectVisible(ui,['OTHER']);assert.equal(ui.element('kb-month-filter').value,'current','deep link does not change the selected month');
    ui.board.openTask('OTHER');await ui.board.toggleChecklist(0,true);assert.equal(ui.writes.length,0);
});

test('canonical save, reopen and reclose dates update membership without sending the selected month to the writer',async()=>{
    let task=row('LIFECYCLE',{createdDate:'2026-09-02T00:00:00Z',status:'Resolved',resolutionDate:'2026-09-10T00:00:00Z'});
    const ui=setup([task],{save:(payload,revision)=>{
        const previous=task;
        task={...previous,...payload,revision:revision+1,resolutionDate:payload.status==='Resolved'
            ? (previous.status==='Resolved'?previous.resolutionDate:'2026-10-06T05:00:00Z') : null};return task;
    }});
    await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');ui.board.openTask('LIFECYCLE');
    await ui.board.toggleChecklist(0,true);expectVisible(ui,['LIFECYCLE']);
    await ui.board.addComment({preventDefault(){},target:{querySelector:()=>({value:'Synthetic comment'})}});expectVisible(ui,['LIFECYCLE']);
    assert.equal(ui.changed.at(-1).createdDate,'2026-09-02T00:00:00Z');assert.equal(ui.changed.at(-1).resolutionDate,'2026-09-10T00:00:00Z');
    ui.board.openTask('LIFECYCLE');await ui.board.handleSaveTask(ui.submit({owner:'u1',due:'2026-10-10',status:'open',next:'',note:''}));
    assert.equal(ui.changed.at(-1).resolutionDate||null,null);expectVisible(ui,['LIFECYCLE']);
    ui.board.openTask('LIFECYCLE');await ui.board.handleSaveTask(ui.submit({owner:'u1',due:'2026-10-10',status:'done',next:'',note:'Finished'}));
    expectVisible(ui,[]);assert.ok(ui.notices.some(message=>/เดือน/.test(message)),'hidden-month save explains its membership');
    assert.equal(ui.changed.at(-1).resolutionDate,'2026-10-06T05:00:00Z');
    ui.board.setMonth('current');expectVisible(ui,['LIFECYCLE']);
    for(const {payload} of ui.writes) {
        assert.equal(payload.actionId,'LIFECYCLE');assert.equal(payload.branch,'AKRA');
        assert.equal(Object.hasOwn(payload,'createdDate'),false);assert.equal(Object.hasOwn(payload,'resolutionDate'),false);
        assert.equal(Object.hasOwn(payload,'month'),false,'selected month never backdates a task');
    }
});

test('new tasks created while browsing history retain server month and explain why they are outside the view',async()=>{
    const ui=setup();await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');
    await ui.board.handleCreateTask(ui.submit({branch:'AKRA',owner:'u1',title:'New fixture',status:'open',next:'',due:'2026-10-10',category:'Warehouse',priority:'normal'}));
    assert.equal(ui.writes.length,1);expectVisible(ui,[]);assert.ok(ui.notices.some(message=>/เดือน/.test(message)));
    ui.board.setMonth('current');assert.equal(visible(ui).length,1);assert.equal(ui.changed.at(-1).createdDate,'2026-10-06T05:00:00.000Z');
});

test('drag close from an old month uses canonical closure time, hides the card and explains the changed month',async()=>{
    const task=row('DRAG-CLOSE',{createdDate:'2026-09-05T00:00:00Z',status:'In Progress',nextStep:'Check delivery 6 Oct',resolutionNote:'Confirmed delivery'});
    const ui=setup([task],{dropStatus:'done',save:(payload,revision)=>({...task,...payload,revision:revision+1,resolutionDate:'2026-10-06T05:00:00Z'})});
    await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');expectVisible(ui,['DRAG-CLOSE']);
    await ui.dropHandlers.drop({preventDefault(){},dataTransfer:{getData:()=> 'AKRA::DRAG-CLOSE'}});
    assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].payload.status,'Resolved');assert.equal(ui.writes[0].revision,1);
    expectVisible(ui,[]);assert.ok(ui.notices.some(message=>/เดือน/.test(message)),'direct drop closure explains the hidden-month result');
    assert.equal(ui.changed.at(-1).createdDate,'2026-09-05T00:00:00Z');assert.equal(ui.changed.at(-1).resolutionDate,'2026-10-06T05:00:00Z');
    ui.board.setMonth('current');expectVisible(ui,['DRAG-CLOSE']);assert.equal(ui.reads.length,1);
});

test('same-status checklist/comment response with a NULL closure remains unknown rather than becoming current',async()=>{
    let task=row('LEGACY-NULL',{status:'Resolved',resolutionDate:null,createdDate:'2026-09-01T00:00:00Z'});
    const ui=setup([task],{save:(payload,revision)=>{task={...task,...payload,revision:revision+1,resolutionDate:null};return task;}});
    await ui.board.loadKanbanBoard();ui.board.setMonth('unknown');ui.board.openTask('LEGACY-NULL');
    await ui.board.toggleChecklist(0,true);expectVisible(ui,['LEGACY-NULL']);
    await ui.board.addComment({preventDefault(){},target:{querySelector:()=>({value:'Still unknown'})}});expectVisible(ui,['LEGACY-NULL']);
    ui.board.setMonth('current');expectVisible(ui,[]);assert.match(ui.element('kb-unknown-closed').textContent,/1/);
    ui.board.setMonth('all');expectVisible(ui,['LEGACY-NULL']);assert.equal(ui.reads.length,1);assert.equal(task.resolutionDate,null);
});

test('canonical image response keeps dates when updating the task without a board refetch',async()=>{
    const task=row('IMAGE',{status:'Resolved',createdDate:'2026-08-10T00:00:00Z',resolutionDate:'2026-09-12T00:00:00Z',attachments:[{id:'image',name:'Synthetic.jpg'}]});
    const ui=setup([task],{api:{getTaskImages:async()=>({images:[]}),removeTaskImage:async()=>({task:{...task,revision:2,attachments:[]}})}});
    await ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');ui.board.openTask('IMAGE');await ui.board.removeImage('image');
    expectVisible(ui,['IMAGE']);ui.board.setMonth('current');expectVisible(ui,[]);assert.equal(ui.reads.length,1);
    ui.board.setMonth('2026-09');expectVisible(ui,['IMAGE']);
});

test('late board loads cannot restore obsolete month/scope/identity records or override a newer load',async()=>{
    let finishOld,readCount=0;
    const ui=setup([],{read:async()=>++readCount===1?new Promise(resolve=>finishOld=resolve):{tasks:[row('FRESH')]}});
    const oldLoad=ui.board.loadKanbanBoard();await ui.board.loadKanbanBoard();expectVisible(ui,['FRESH']);
    finishOld({tasks:[row('STALE')]});await oldLoad;expectVisible(ui,['FRESH']);
    let finishIdentity;ui.window.AkraSupabaseKPI.getKanbanBoard=()=>new Promise(resolve=>finishIdentity=resolve);
    const identityLoad=ui.board.loadKanbanBoard();ui.setIdentity({token:'replacement',userUid:'u2',branch:'TRD',roles:['TRD'],allowedBranches:['TRD']});
    finishIdentity({tasks:[row('PRIVATE-OLD')]});await identityLoad;await drain();
    assert.doesNotMatch(ui.element('kb-board-content').innerHTML,/Task PRIVATE-OLD/);
    ui.window.AkraSupabaseKPI.getKanbanBoard=async()=>({tasks:[row('TRD-FRESH',{branch:'TRD'})]});await ui.board.loadKanbanBoard();
    expectVisible(ui,['TRD::TRD-FRESH']);assert.equal(ui.element('kb-month-filter').value,'current');
});

test('delayed old branch read cannot overwrite the selected branch and month while new read is pending',async()=>{
    const finish={};
    const ui=setup([],{read:async(_token,branch)=>new Promise(resolve=>finish[branch]=resolve)});
    const oldLoad=ui.board.loadKanbanBoard();ui.board.setMonth('2026-09');
    const selectedLoad=ui.board.setBranchScope('TRD');ui.board.setMonth('2026-08');
    finish.AKRA({tasks:[row('STALE-BRANCH',{createdDate:'2026-08-05T00:00:00Z'})]});await oldLoad;expectVisible(ui,[]);
    finish.TRD({tasks:[row('SELECTED',{branch:'TRD',createdDate:'2026-08-05T00:00:00Z'}),row('SEPT',{branch:'TRD',createdDate:'2026-09-05T00:00:00Z'})]});
    await selectedLoad;expectVisible(ui,['TRD::SELECTED']);
    expectVisible(ui,['TRD::SELECTED']);assert.equal(ui.element('kb-branch-scope').value,'TRD');assert.equal(ui.element('kb-month-filter').value,'2026-08');
});
