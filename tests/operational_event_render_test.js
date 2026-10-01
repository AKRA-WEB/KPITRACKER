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
  'wl-dashboard-receive', 'wl-dashboard-outbound', 'wl-dashboard-filter-all', 'wl-dashboard-filter-line',
  'wl-dashboard-distribution', 'wl-dashboard-distribution-label', 'wl-dashboard-people-badge',
  'wl-dashboard-assigned-badge', 'wl-dashboard-assigned-list',
  'wl-dashboard-activity-list', 'wl-dashboard-people-list', 'wl-dashboard-category-list'
];
const nodes = new Map(ids.map(id => [id, { textContent: '', innerHTML: '' }]));
const sandbox = {
  document: { getElementById: id => nodes.get(id) || null },
  liveRequisitionsList: [{
    billNo: '#1', requester: 'หน้าร้าน TRD', requesterEmployeeName: 'หน้าร้าน', requesterIdentityStatus: 'linked',
    assigneeEmployeeName: 'ปีเตอร์', assigneeIdentityStatus: 'linked', categoryLabel: '1. บิลด่วน / เบิกด่วน',
    itemsSummary: 'แป้ง 2 ลัง', workloadEligible: true, time: '09:10', status: 'รับรายการ'
  }],
  liveOperationalEventsList: [
    { eventType: 'W5_TO_AKRA', category: 'MOVE', categoryLabel: 'ย้ายสต๊อก W5 → AKRA', sourceLabel: 'AKRA W5', title: 'ย้ายสต๊อก W5 → AKRA', actorEmployeeUid: 'peter', actorName: 'ปีเตอร์', time: '08:20', occurredAt: '2026-09-20T01:20:00Z', itemCount: 1, totalUnits: 2 },
    { eventType: 'AKRA_TO_TRD', category: 'MOVE', categoryLabel: 'ย้ายสต๊อก AKRA → TRD', sourceLabel: 'TRDAKRA', title: 'ย้ายสต๊อก AKRA → TRD', actorEmployeeUid: 'akra', actorName: 'คลัง AKRA', time: '08:30', occurredAt: '2026-09-20T01:30:00Z', itemCount: 1, totalUnits: 3 },
    { eventType: 'TRD_RECEIPT_CONFIRMED', category: 'RECEIVE', categoryLabel: 'รับสินค้า TRD', sourceLabel: 'TRDAKRA', title: 'ยืนยันรับสินค้า TRD', actorEmployeeUid: 'trd', actorName: 'คลัง TRD', time: '08:45', occurredAt: '2026-09-20T01:45:00Z', itemCount: 1, totalUnits: 3 },
    { eventType: 'W5_TO_AKRA', category: 'MOVE', categoryLabel: 'ย้ายสต๊อก W5 → AKRA', sourceLabel: 'AKRA W5', title: 'ย้ายสต๊อก W5 → AKRA', actorEmployeeUid: 'eyang', actorName: 'เอี้ยง', time: '08:50', occurredAt: '2026-09-20T01:50:00Z', itemCount: 1, totalUnits: 1 },
    { eventType: 'W5_TO_AKRA', category: 'MOVE', categoryLabel: 'ย้ายสต๊อก W5 → AKRA', sourceLabel: 'AKRA W5', title: 'ย้ายสต๊อก W5 → AKRA', actorEmployeeUid: 'mooyong', actorName: 'หมูหยอง', time: '08:55', occurredAt: '2026-09-20T01:55:00Z', itemCount: 1, totalUnits: 1 },
    { eventType: 'GR_COMPLETED', category: 'INBOUND', categoryLabel: 'รับสินค้าเข้า (GR)', sourceLabel: 'GR', title: 'รับสินค้าเข้า (GR) → สอน', actorEmployeeUid: 'son', actorName: 'สอน', time: '09:00', occurredAt: '2026-09-20T02:00:00Z', itemCount: 1, totalUnits: 4 }
  ],
  esc: value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  console
};
vm.createContext(sandbox);
vm.runInContext(renderSource, sandbox);
sandbox.renderUnifiedWorkloadActivity();

assert.equal(nodes.get('wl-dashboard-total').textContent, '7');
assert.equal(nodes.get('wl-dashboard-line').textContent, '1');
assert.equal(nodes.get('wl-dashboard-gr').textContent, '1');
assert.equal(nodes.get('wl-dashboard-move').textContent, '4');
assert.equal(nodes.get('wl-dashboard-receive').textContent, '1');
assert.equal(nodes.get('wl-unified-activity-count').textContent, '7 งานรวม');
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /ย้ายสินค้า W5/);
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /จัดสินค้าสต๊อค/);
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /รับลงสินค้า/);
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /รับสินค้าสต๊อค/);
assert.match(nodes.get('wl-dashboard-people-list').innerHTML, /สอน/, 'all counted operators, including the sixth person, must be visible');
assert.match(nodes.get('wl-dashboard-category-list').innerHTML, /เบิกสินค้าสต๊อค TRD/);
assert.match(nodes.get('wl-dashboard-category-list').innerHTML, /บิลด่วน/);

console.log('PASS: unified Workload merges TRD requisitions with GR, W5 and TRD operational events');

const receipt = sandbox.liveOperationalEventsList.find(row => row.eventType === 'TRD_RECEIPT_CONFIRMED');
receipt.sourceRef = 'trd-receipt-1790486787345-fixture';
receipt.details = 'รับจริง 178.0000 หน่วย · ไม่ครบ 2 รายการ';
sandbox.renderUnifiedWorkloadActivity();
for (const id of ['wl-dashboard-people-list', 'wl-dashboard-activity-list', 'wl-unified-activity-list']) {
  assert.doesNotMatch(nodes.get(id).innerHTML, /trd-receipt-1790486787345-fixture|178\.0000|—<\/span>:/);
  assert.match(nodes.get(id).innerHTML, /รับจริง 178 หน่วย · ไม่ครบ 2 รายการ/);
}
assert.equal(nodes.get('wl-dashboard-total').textContent, '7', 'presentation changes must not change activity totals');
receipt.details = 'รับจริง 0.1250 หน่วย · สินค้ารหัส 25.5000';
sandbox.renderUnifiedWorkloadActivity();
assert.match(nodes.get('wl-dashboard-people-list').innerHTML, /0\.125 หน่วย · สินค้ารหัส 25\.5000/, 'fractional quantities and product identifiers remain accurate');
nodes.set('wl-filter-search', { value: 'รับสินค้าสต๊อค' });
sandbox.renderUnifiedWorkloadActivity();
assert.equal(nodes.get('wl-dashboard-total').textContent, '1', 'the visible activity name is searchable');
assert.equal(nodes.get('wl-dashboard-receive').textContent, '1');
console.log('PASS: short activity names, hidden internal IDs, precise quantities and label search');
