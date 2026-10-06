// Execute the real client with synthetic fetch/session objects; no network requests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(respond) {
    let owner={},token='synthetic';const calls=[];
    const window={getKpiSessionOwner:()=>owner,getKpiSessionToken:()=>token};
    const context=vm.createContext({window,self:window,console,AbortController,setTimeout,clearTimeout,
        fetch:async(url,options)=>{
            assert.ok(url.endsWith('/functions/v1/kpi-api'));const request=JSON.parse(options.body);calls.push(request);
            const data=await respond(request,calls.length);
            return {ok:true,json:async()=>data};
        }});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/supabase-kpi-client.js'),'utf8'),context);
    return {client:window.AkraSupabaseKPI,calls,replaceOwner(){owner={};},setToken:value=>{token=value;}};
}

test('actual Kanban client drains 0/499/500/501/1001 records once and preserves canonical dates and first-page metadata',async t=>{
    for(const count of [0,499,500,501,1001])await t.test(String(count)+' rows',async()=>{
        const rows=Array.from({length:count},(_,index)=>({actionId:'TASK-'+index,branch:'AKRA',createdDate:'2026-09-30T17:00:00Z',resolutionDate:index%2?'2026-10-02T00:00:00Z':null}));
        const ui=setup(request=>{
            assert.equal(request.action,'getKanbanBoard');assert.equal(request.token,'synthetic');assert.equal(request.branch,'AKRA');assert.equal(request.includeArchived,false);
            const start=request.cursor?Number(request.cursor.slice('cursor-'.length)):0;
            const end=Math.min(start+500,count);
            return {status:'success',branch:'AKRA',tasks:rows.slice(start,end),nextCursor:end-start===500?'cursor-'+end:null,
                employees:start===0?[{employeeUid:'one',name:'One'}]:[],counts:{open:count},issueIntegrationReady:false};
        });
        const board=await ui.client.getKanbanBoard('synthetic','AKRA',{includeArchived:false});
        assert.equal(board.tasks.length,count);assert.equal(new Set(board.tasks.map(row=>row.actionId)).size,count);
        assert.deepEqual(Array.from(board.tasks,row=>row.actionId),rows.map(row=>row.actionId));
        assert.equal(board.nextCursor,null);assert.equal(board.employees[0].employeeUid,'one');assert.equal(board.counts.open,count);
        assert.equal(ui.calls.length,Math.floor(count/500)+1,'a full final page is drained through its terminal empty page');
        if(count)assert.equal(board.tasks.at(-1).createdDate,'2026-09-30T17:00:00Z');
    });
});

test('repeated cursor rejects rather than silently returning a truncated or duplicate board',async()=>{
    const ui=setup((_request,page)=>({status:'success',tasks:[{actionId:'PAGE-'+page}],nextCursor:'same-cursor'}));
    await assert.rejects(ui.client.getKanbanBoard('synthetic','TRD'),/repeated_kanban_cursor/);assert.equal(ui.calls.length,2);
});

test('malformed later page rejects the complete read instead of reporting partial tasks',async()=>{
    const ui=setup((_request,page)=>({status:'success',tasks:page===1?[{actionId:'FIRST'}]:null,nextCursor:page===1?'next':null}));
    await assert.rejects(ui.client.getKanbanBoard('synthetic','AKRA'),/invalid_kanban_board_response/);assert.equal(ui.calls.length,2);
});

test('delayed later page retains all records when the session remains unchanged',async()=>{
    let finish;
    const ui=setup((_request,page)=>page===1?{status:'success',tasks:[{actionId:'FIRST'}],nextCursor:'next'}:new Promise(resolve=>finish=resolve));
    const pending=ui.client.getKanbanBoard('synthetic','AKRA');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ui.calls.length,2);finish({status:'success',tasks:[{actionId:'SECOND'}],nextCursor:null});
    const board=await pending;assert.deepEqual(Array.from(board.tasks,row=>row.actionId),['FIRST','SECOND']);
});

test('identity or token change during a delayed page rejects stale data and makes no extra page request',async()=>{
    for(const change of ['owner','token']) {
        let finish;
        const ui=setup((_request,page)=>page===1?{status:'success',tasks:[{actionId:'FIRST'}],nextCursor:'next'}:new Promise(resolve=>finish=resolve));
        const pending=ui.client.getKanbanBoard('synthetic','TRD');await new Promise(resolve=>setImmediate(resolve));
        if(change==='owner')ui.replaceOwner();else ui.setToken('rotated');
        finish({status:'success',tasks:[{actionId:'STALE'}],nextCursor:'another'});
        await assert.rejects(pending,/session_changed/);assert.equal(ui.calls.length,2);
    }
});
