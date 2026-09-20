const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /liveOperationalEventsList/, 'KPI must keep a separate operational event feed');
assert.match(html, /TRD Requisition/, 'unified Workload must expose the consolidated TRD requisition label');
assert.match(html, /W5 → AKRA/, 'unified Workload must expose W5 to AKRA movement');
assert.match(html, /AKRA → TRD/, 'unified Workload must expose AKRA to TRD movement');
assert.match(html, /รับสินค้าเข้า \(GR\)/, 'unified Workload must expose GR inbound events');

console.log('PASS: unified Workload source labels and operational event feed contract are present');
