const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^\\{]*?\\)\\s*\\{`).exec(source);
  assert.ok(match, `${name} must exist`);
  let depth = 0;
  for (let index = match.index; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  throw new Error(`Could not close ${name}`);
}

assert.match(html, /id="wl-unified-activity-card"/, 'Workload must contain a unified activity card');
assert.match(html, /id="wl-unified-activity-list"/, 'Workload must contain an activity list');
assert.match(html, /id="wl-unified-dashboard"/, 'Workload must contain the unified dashboard');
assert.match(html, /Workload รวม/, 'Workload must be presented as a unified read-only view');
assert.match(html, /<div class="hidden grid grid-cols-1 lg:grid-cols-12 gap-4" aria-hidden="true">/, 'Legacy manual workload editor must stay out of the user path');

const renderFn = extractFunction(html, 'renderUnifiedWorkloadActivity');
const nodes = new Map([
  ['wl-unified-activity-count', { textContent: '' }],
  ['wl-unified-identity-count', { textContent: '' }],
  ['wl-unified-activity-list', { innerHTML: '' }],
  ['wl-dashboard-total', { textContent: '' }],
  ['wl-dashboard-people', { textContent: '' }],
  ['wl-dashboard-sources', { textContent: '' }],
  ['wl-dashboard-coverage', { textContent: '' }],
  ['wl-dashboard-coverage-note', { textContent: '' }],
  ['wl-dashboard-people-badge', { textContent: '' }],
  ['wl-dashboard-activity-list', { innerHTML: '' }],
  ['wl-dashboard-people-list', { innerHTML: '' }],
  ['wl-dashboard-category-list', { innerHTML: '' }]
]);
const sandbox = {
  document: { getElementById: id => nodes.get(id) || null },
  liveRequisitionsList: [{
    billNo: '#1',
    time: '11:37 น.',
    requester: 'Gawit TRD',
    requesterEmployeeUid: 'gawit',
    requesterEmployeeName: 'กาวิช',
    requesterIdentityStatus: 'linked',
    assigneeLabel: '@TER',
    assigneeEmployeeUid: '260029',
    assigneeEmployeeName: 'ปีเตอร์',
    assigneeIdentityStatus: 'linked',
    categoryLabel: '3. บิลเบิกเรียงของหน้าร้าน',
    itemsSummary: 'ขนม 1 ลัง',
    totalUnits: 1,
    status: '⏳ รอจัดสินค้า'
  }, {
    billNo: '#2',
    time: '11:04 น.',
    requester: 'Unknown LINE',
    requesterIdentityStatus: 'unlinked',
    categoryLabel: '1. บิลด่วน / เบิกด่วน',
    itemsSummary: 'นม 1 ลัง',
    totalUnits: 1,
    status: '⏳ รอจัดสินค้า'
  }],
  esc: value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  console
};
vm.createContext(sandbox);
vm.runInContext(renderFn, sandbox);
sandbox.renderUnifiedWorkloadActivity();

assert.equal(nodes.get('wl-unified-activity-count').textContent, '2 งานจาก LINE');
assert.equal(nodes.get('wl-unified-identity-count').textContent, '1 รายการรอจับคู่');
assert.equal(nodes.get('wl-dashboard-total').textContent, '2');
assert.equal(nodes.get('wl-dashboard-people').textContent, '2');
assert.equal(nodes.get('wl-dashboard-sources').textContent, 'LINE');
assert.equal(nodes.get('wl-dashboard-coverage').textContent, '50%');
assert.match(nodes.get('wl-dashboard-activity-list').innerHTML, /ปีเตอร์/);
assert.match(nodes.get('wl-dashboard-people-list').innerHTML, /ปีเตอร์/);
assert.match(nodes.get('wl-dashboard-category-list').innerHTML, /บิลด่วน/);
assert.match(nodes.get('wl-unified-activity-list').innerHTML, /ผู้ขอเบิกระบบ: กาวิช/);
assert.match(nodes.get('wl-unified-activity-list').innerHTML, /ผู้รับงานตาม Mention: ปีเตอร์/);
assert.match(nodes.get('wl-unified-activity-list').innerHTML, /ยังไม่ผูกบัญชี/);

console.log('PASS: unified Workload renders linked, mentioned and unresolved identities separately');
