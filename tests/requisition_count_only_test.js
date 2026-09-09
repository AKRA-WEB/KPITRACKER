const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const controller = html.slice(html.indexOf('        const LINE_REQUISITION_API_URL'), html.indexOf('        function applyAkraWorkloadDraft'));
const nodes = new Map(['live-bill-count', 'live-bill-list-cards', 'live-bill-read-state'].map(id => [id, { innerText: '', innerHTML: '' }]));
const requests = [];
const ctx = vm.createContext({
    document: { getElementById: id => nodes.get(id) || null },
    console: { warn() {} },
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve }))
});
vm.runInContext(controller, ctx);
const run = code => vm.runInContext(code, ctx);
const count = () => nodes.get('live-bill-count').innerText;
const respond = (i, data, ok = true) => requests[i].resolve({ ok, json: async () => data });
(async () => {
    run(`liveRequisitionsList = [
        {uid:'1',status:'จัดเสร็จแล้ว',doneBy:'private actor',itemsSummary:'<img src=x onerror=alert(1)>',rawText:'source text'},
        {uid:'1',status:'รอจัดสินค้า'},
        {uid:'2',status:'ของหมด'},
        {uid:'3',messageId:'M3',status:'waiting'},
        {uid:'4',messageId:'M3',status:'done'},
        {uid:'5',itemsSummary:'same text'}, {uid:'6',itemsSummary:'same text'},
        {itemsSummary:'legacy no ID'}
    ]; before = JSON.stringify(liveRequisitionsList); renderLiveRequisitions();`);
    assert.equal(count(), '6');
    assert.equal(run('JSON.stringify(liveRequisitionsList)'), run('before'), 'Historical objects must remain intact');
    const rendered = nodes.get('live-bill-list-cards').innerHTML;
    assert.doesNotMatch(rendered, /private actor|จัดเสร็จ|รอจัดสินค้า|ของหมด|Reaction|markReqStatus/);
    assert.match(rendered, /&lt;img/);
    assert.match(rendered, /source text/);
    run('liveRequisitionsList = []; renderLiveRequisitions();');
    assert.equal(count(), '0');
    const old = run("fetchLiveRequisitions('2026-09-08')");
    assert.equal(count(), '—');
    const fresh = run("fetchLiveRequisitions('2026-09-09')");
    respond(1, { success: true, date: '2026-09-09', requisitions: [{uid:'new'}] });
    await fresh;
    respond(0, { success: true, date: '2026-09-08', requisitions: [{uid:'old'}, {uid:'old2'}] });
    await old;
    assert.equal(count(), '1', 'Late previous-day response must not replace selected day');
    const fail = run("fetchLiveRequisitions('2026-09-10')");
    respond(2, {}, false); await fail;
    assert.equal(count(), '—', 'Failure is unknown, not zero or stale count');
    assert.match(nodes.get('live-bill-read-state').innerText, /ไม่สำเร็จ/);
    const wrong = run("fetchLiveRequisitions('2026-09-11')");
    respond(3, {success:true,date:'2026-09-10',requisitions:[]}); await wrong;
    assert.equal(count(), '—');
    assert.ok(requests.every(r => !r.options), 'Count-only flow only reads');
    assert.equal(run('typeof markReqStatus'), 'undefined');
    console.log('PASS count-only: status-independent counts, stable-ID dedup, history preserved, escaped text, empty/error and stale-date isolation; no status writer');
})().catch(error => { console.error(error); process.exitCode = 1; });
