const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const context = vm.createContext({ structuredClone, Intl, Date });
vm.runInContext(extractFunction('getTodayBangkokDateStr'), context);
vm.runInContext(extractFunction('formatDateKeyLocal'), context);
vm.runInContext(extractFunction('parseDateKeyLocal'), context);
vm.runInContext(extractFunction('normalizeClientDateKey'), context);
vm.runInContext(extractFunction('normalizeEmpName'), context);
vm.runInContext(extractFunction('mergeAuthoritativeWorkloadData'), context);

const gasData = [
  {
    date: '2026-08-23', branch: 'AKRA', errors: [{ type: 'keep-me' }], tasks: [{ taskName: 'keep-me' }],
    workload: [
      { employee: 'หมูหยอง', outbound: 10 },
      { employee: 'legacy-peer', outbound: 10 }
    ]
  },
  {
    date: '2026-08-20', branch: 'AKRA', errors: [], tasks: [],
    workload: [{ employee: 'historical-user', outbound: 10 }]
  }
];
const edgeRecords = [
  { date: '2026-08-23', workload: [{ employeeUid: '250007', employee: 'หมูหยอง', outbound: 5, inbound: 3, transfer: 1, shared: 1 }] },
  { date: '2026-08-24', workload: [{ employeeUid: '250008', employee: 'เอี้ยง', outbound: 10, inbound: 0, transfer: 0, shared: 0 }] }
];

const merged = context.mergeAuthoritativeWorkloadData(gasData, edgeRecords, 'AKRA');
const existingDay = merged.find(day => day.date === '2026-08-23');
const workloadOnlyDay = merged.find(day => day.date === '2026-08-24');
const historicalDay = merged.find(day => day.date === '2026-08-20');

assert.deepStrictEqual(JSON.parse(JSON.stringify(existingDay.errors)), [{ type: 'keep-me' }], 'non-Workload sections must be preserved');
assert.deepStrictEqual(JSON.parse(JSON.stringify(existingDay.tasks)), [{ taskName: 'keep-me' }]);
assert.equal(existingDay.workload.length, 1, 'Supabase Workload must be authoritative for managed dates');
assert.equal(existingDay.workload[0].employeeUid, '250007', 'Supabase Workload entry must be preserved');
assert.equal(workloadOnlyDay.workload[0].employeeUid, '250008', 'a Workload-only date must be added to the daily data');
assert.equal(workloadOnlyDay.branch, 'AKRA');
assert.equal(historicalDay.workload[0].employee, 'historical-user', 'historical dates not in Supabase must retain GAS data');
assert.equal(gasData[0].workload[0].outbound, 10, 'merge must not mutate the source cache value');

const trd = context.mergeAuthoritativeWorkloadData(gasData, edgeRecords, 'TRD');
assert.equal(trd[0].workload[0].outbound, 10, 'TRD data must remain outside the AKRA Workload authority');

console.log('KPI authoritative Workload overlay behavior passed.');
