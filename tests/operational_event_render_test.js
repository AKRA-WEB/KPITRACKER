const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = /function renderUnifiedWorkloadActivity\s*\([^\{]*\)\s*\{/.exec(html);
assert.ok(match, 'unified renderer must exist');
let depth = 0;
let renderSource = '';
for (let index = match.index; index < html.length; index += 1) {
  if (html[index] === '{') depth += 1;
  if (html[index] === '}') {
    depth -= 1;
    if (depth === 0) {
      renderSource = html.slice(match.index, index + 1);
      break;
    }
  }
}

const ids = [
  'wl-unified-activity-count', 'wl-unified-identity-count', 'wl-unified-activity-list',
  'wl-dashboard-total', 'wl-dashboard-people', 'wl-dashboard-sources', 'wl-dashboard-coverage',
  'wl-dashboard-coverage-note', 'wl-dashboard-line', 'wl-dashboard-gr', 'wl-dashboard-move',
  'wl-dashboard-outbound', 'wl-dashboard-filter-all', 'wl-dashboard-filter-line',
  'wl-dashboard-distribution', 'wl-dashboard-distribution-label', 'wl-dashboard-people-badge',
  'wl-dashboard-activity-list', 'wl-dashboard-people-list', 'wl-dashboard-category-list'
];
const nodes = new Map(ids.map(id => [id, { textContent: '', innerHTML: '' }]));
const sandbox = {
  document: { getElementById: id => nodes.get(id) || null },
  liveRequisitionsList: [{
    billNo: '#1', requester: 'หน้าร้าน TRD', requesterEmployeeName: 'หน้าร้าน', requesterIdentityStatus: 'linked',
    assigneeEmployeeName: 'ปีเตอร์', assigneeIdentityStatus: 'linked', categoryLabel: '1. บิลด่วน / เบิกด่วน',
    itemsSummary: 'แป้ง 2 ลัง', time: '09:10', status: 'รับรายการ'
  }],
  liveOperationalEventsList: [
    { eventType: 'GR_COMPLETED', category: 'INBOUND', categoryLabel: 'รับสินค้าเข้า (GR)', sourceLabel: 'GR', title: 'รับสินค้าเข้า (GR) → สอน', actorName: 'สอน', time: '08:10', occurredAt: '2026-09-20T01:10:00Z', itemCount: 1, totalUnits: 4 },
    { eventType: 'W5_TO_AKRA', category: 'MOVE', categoryLabel: 'ย้ายสต๊อก W5 → AKRA', sourceLabel: 'AKRA W5', title: 'ย้ายสต๊อก W5 → AKRA', actorName: 'ปีเตอร์', time: '08:20', occurredAt: '2026-09-20T01:20:00Z', itemCount: 1, totalUnits: 2 },
    { eventType: 'AKRA_TO_TRD', category: 'MOVE', categoryLabel: 'ย้ายสต๊อก AKRA → TRD', sourceLabel: 'TRDAKRA', title: 'ย้ายสต๊อก AKRA → TRD', actorName: 'คลัง AKRA', time: '08:30', occurredAt: '2026-09-20T01:30:00Z', itemCount: 1, totalUnits: 3 }
  ],
  esc: value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  console
};
vm.createContext(sandbox);
vm.runInContext(renderSource, sandbox);
sandbox.renderUnifiedWorkloadActivity();

assert.equal(nodes.get('wl-dashboard-total').textContent, '4');
assert.equal(nodes.get('wl-dashboard-line').textContent, '1');
assert.equal(nodes.get('wl-dashboard-gr').textContent, '1');
assert.equal(nodes.get('wl-dashboard-move').textContent, '2');
assert.equal(nodes.get('wl-unified-activity-count').textContent, '4 งานรวม');
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /ย้ายสต๊อก W5/);
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /ย้ายสต๊อก AKRA/);
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /รับสินค้าเข้า/);
assert.match(nodes.get('wl-dashboard-category-list').innerHTML, /TRD Requisition/);
assert.match(nodes.get('wl-dashboard-category-list').innerHTML, /บิลด่วน/);

console.log('PASS: unified Workload merges TRD requisitions with GR, W5 and TRD operational events');
