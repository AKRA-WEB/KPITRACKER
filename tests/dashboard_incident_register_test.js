const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const context = {
    console, document: {addEventListener() {}, querySelectorAll() {return [];}, getElementById() {return {addEventListener() {}};}},
    addEventListener() {}, setTimeout, clearTimeout, URL, URLSearchParams,
    location: {search: '', hostname: 'localhost'}, navigator: {},
    localStorage: {getItem() {return null;}, setItem() {}, removeItem() {}},
    sessionStorage: {getItem() {return null;}}, alert() {}
};
context.window = context;
vm.createContext(context);
for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (source.trim()) new vm.Script(source).runInContext(context);
}
// Exercise the actual renderer; notes enter through the existing escaped display pipeline.
const rows = [
    {emp: 'Older', type: 'Type', date: '2026-09-14', note: 'old'},
    {emp: '<img src=x>', type: '<script>alert(1)</script>', date: '2026-09-15', note: 'escaped &lt;b&gt;note&lt;/b&gt;'},
    {emp: 'Third', type: 'Other', date: '2026-09-15', note: 'third'}
];
const original = JSON.stringify(rows);
const output = context.renderDashboardIncidentRegister(rows, true);
const cells = [...output.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
assert.equal(cells.length, 9);
assert.equal(cells[1], '&lt;img src=x&gt;');
assert.equal(cells[4], 'Third');
assert.equal(cells[7], 'Older');
assert.equal(cells[2], '<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong><div>escaped &lt;b&gt;note&lt;/b&gt;</div>');
assert.equal(JSON.stringify(rows), original, 'rendering must not reorder or mutate source rows');
assert.equal(context.renderDashboardIncidentRegister([], false), '<p class="kpi-register-empty">ไม่มีข้อผิดพลาดในสัปดาห์นี้</p>');
assert.equal(context.renderDashboardIncidentRegister([], true), '<p class="kpi-register-empty">มีบันทึกข้อผิดพลาดของอดีตพนักงาน (สามารถดูรายละเอียดได้จากการส่งออกข้อมูลประวัติ)</p>');
console.log('PASS: actual register renderer preserves rows, sorts newest first, escapes labels and distinguishes empty/historical states.');

const elements = new Map();
context.document.getElementById = id => {
    if (!elements.has(id)) {
        const parent = {hidden: false};
        elements.set(id, {innerHTML: '', innerText: '', className: '', parentElement: parent, closest() {return parent;}});
    }
    return elements.get(id);
};
vm.runInContext("currentBranch='AKRA'; viewOffsetWeek=0; dashboardSelectedDate='ALL'; ALL_ACTIONS=[]; _fetchingActions=false; _actionsLoadError='';", context);
const date = context.formatDateKeyLocal(new Date());
context.renderEndOfShiftDashboard([{date, endOfShift: {summary: 'Recorded report'}}]);
assert.equal(elements.get('dash-eos-list').parentElement.hidden, false);
assert.equal([...elements.get('dash-eos-list').innerHTML.matchAll(/<article\b/g)].length, 1);
assert.equal([...elements.get('dash-eos-date-filter').innerHTML.matchAll(/<button\b/g)].length, 2);
context.renderEndOfShiftDashboard([{date, endOfShift: {summary: '   '}}]);
assert.equal(elements.get('dash-eos-list').parentElement.hidden, true);
assert.equal(elements.get('dash-eos-list').innerHTML, '');
assert.equal(elements.get('dash-actions-list').parentElement.hidden, true);
vm.runInContext("_actionsLoadError='Unavailable'", context);
context.renderEndOfShiftDashboard([]);
assert.equal(elements.get('dash-actions-list').parentElement.hidden, false, 'load failure must remain visible');
vm.runInContext("_actionsLoadError=''; dashboardSelectedDate='2000-01-01'", context);
context.renderEndOfShiftDashboard([{date, endOfShift: {summary: 'Report restored'}}]);
assert.equal(elements.get('dash-eos-list').parentElement.hidden, false);
assert.equal(vm.runInContext('dashboardSelectedDate', context), 'ALL');
console.log('PASS: daily reports hide blank dates/sections, return with data, reset stale selection, and retain action load errors.');
