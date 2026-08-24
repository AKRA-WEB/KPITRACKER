const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = html.indexOf('{', start);
  let depth = 1;
  for (let index = open + 1; index < html.length; index++) {
    if (html[index] === '{') depth++;
    if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const context = vm.createContext({
  GLOBAL_CONFIG_LIST: [],
  USER_DB: {},
  TRD_DEPARTMENTS: {},
  getRealErrorEntries: () => [],
  normalizeEndOfShiftBrief: () => ({ issues: '', followUps: '', vendorBills: { totalToday: '', entryStatus: '' } }),
  hasEndOfShiftContent: () => false,
  currentBranch: 'AKRA',
  currentUser: 'AKRA12123',
  displayUserName: 'TRAINEE (SORN)',
  workloadState: { core: 'คลัง W1', coreLabel: 'คลังหลัก W1', support: [], totalHours: 10 },
  esc: value => String(value),
  updateAkraDutyCount() {},
  syncAkraSharedEntries() {},
  renderWorkload() {},
  renderErrSeverity() {},
  renderErrEmpChips() {},
  renderErrTimeline() {},
  renderErrTeamHp() {},
  BRANCH_CONFIG: {
    AKRA: { employees: [], showZone2: true },
    TRD: { employees: [], showZone2: false }
  }
});

[
  'getBranchesFromMainRoles',
  'normalizeEmpName',
  'getPreviousKpiDate',
  'getEmployeeWorkloadStatus',
  'dedupeConfigList',
  'normalizeMainEmployeeStatus',
  'processConfigList',
  'getBranchRosterEmployees',
  'resolveWorkloadEmployee',
  'normalizeWorkloadEntry',
  'getCanonicalWorkloadEntry',
  'getCanonicalWorkloadEntries',
  'getStartOfWeek',
  'computeWorkloadTrend',
  'aggregateDescriptivePeriod',
  'renderAkraWorkloadEditor',
  'setCheckedValues',
  'applyAkraRosterDraft',
  'renderTeamWorkloadPreview'
].forEach(name => vm.runInContext(extractFunction(name), context));

context.processConfigList([
  {
    uid: 'TRAINEE_SORN',
    name: 'SORN',
    roles: ['WAREHOUSE'],
    branches: 'AKRA',
    status: 'Active'
  },
  {
    uid: 'AKRA12123',
    name: 'TRAINEE (SORN)',
    aliasUids: ['TRAINEE_SORN'], aliasNames: ['SORN'],
    roles: ['WAREHOUSE'],
    branches: 'AKRA',
    status: 'Active'
  }
]);

assert.deepStrictEqual(
  Array.from(context.BRANCH_CONFIG.AKRA.employees),
  ['TRAINEE (SORN)'],
  'a verified legacy UID/name alias must render once under the exact current Main display name'
);
assert.deepStrictEqual(
  Array.from(context.GLOBAL_CONFIG_LIST, employee => employee.uid),
  ['AKRA12123'],
  'the active config must retain only the canonical Main UID'
);

assert.deepStrictEqual(
  Array.from(context.dedupeConfigList([
    { uid: 'A', name: 'Shared Name' },
    { uid: 'B', name: 'Shared Name' }
  ]), employee => employee.uid),
  ['A', 'B'],
  'distinct stable UIDs must never collapse merely because display names match'
);
assert.deepStrictEqual(
  Array.from(context.dedupeConfigList([
    { uid: 'CANONICAL', name: 'Current Name', aliasUids: ['LEGACY_UID'], aliasNames: ['Legacy Label'] },
    { uid: 'Legacy Label', name: 'Distinct User' }
  ]), employee => employee.uid),
  ['CANONICAL', 'Legacy Label'],
  'a display name matching another account alias must not suppress a distinct stable UID'
);

context.processConfigList([
  { uid: 'A', name: 'Shared Name', roles: ['AKRA'], status: 'Active' },
  { uid: 'B', name: 'Shared Name', roles: ['AKRA'], status: 'Active' }
]);
assert.deepStrictEqual(Array.from(context.BRANCH_CONFIG.AKRA.employees), ['Shared Name', 'Shared Name'],
  'the operational roster must retain one row per Main UID even when labels are identical');
assert.deepStrictEqual(Array.from(context.getBranchRosterEmployees('AKRA'), employee => employee.uid), ['A', 'B'],
  'Workload consumers must receive UID-bearing roster entries');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.resolveWorkloadEmployee({ employee: 'Shared Name' }, context.GLOBAL_CONFIG_LIST))),
  { uid: '', name: 'Shared Name' },
  'ambiguous name-only history must not be assigned to the first same-name Main UID'
);

const sharedNameCheckboxes = [
  { value: 'A', dataset: { name: 'Shared Name' }, checked: false },
  { value: 'B', dataset: { name: 'Shared Name' }, checked: false }
];
context.document = {
  querySelectorAll: selector => selector === '.akra-duty-cb' ? sharedNameCheckboxes : [],
  getElementById: () => null
};
context.applyAkraRosterDraft({
  onDuty: ['Shared Name'],
  onDutyRoster: [{ uid: 'A', name: 'Shared Name' }],
  cores: {}
});
assert.deepStrictEqual(
  sharedNameCheckboxes.map(checkbox => checkbox.checked),
  [true, false],
  'UID-bearing roster drafts must restore exclusively by UID when two Main accounts share a display name'
);

const preview = { innerHTML: '' };
const dutyCount = { textContent: '' };
context.currentUser = 'A';
context.displayUserName = 'Shared Name';
context.workloadState = { core: 'รับสินค้าเข้า', support: [{ name: 'ช่วยย้ายของ W2', hours: 3 }] };
context.getAkraOnDutyRoster = () => [
  { uid: 'A', name: 'Shared Name' },
  { uid: 'B', name: 'Shared Name' }
];
context.document = {
  querySelectorAll: () => [],
  getElementById: id => id === 'wl-team-preview' ? preview : (id === 'akra-duty-count' ? dutyCount : null)
};
context.renderTeamWorkloadPreview();
assert.strictEqual((preview.innerHTML.match(/คุณ/g) || []).length, 1,
  'team preview must mark exactly the current stable UID as you');
assert.strictEqual((preview.innerHTML.match(/รับสินค้าเข้า/g) || []).length, 1,
  'team preview must not copy the current user workload onto a same-name peer');
context.currentUser = 'AKRA12123';
context.displayUserName = 'TRAINEE (SORN)';
context.workloadState = { core: 'คลัง W1', coreLabel: 'คลังหลัก W1', support: [], totalHours: 10 };

context.processConfigList([
  {
    uid: 'TRAINEE_SORN', name: 'SORN', roles: ['WAREHOUSE'], branches: 'AKRA', status: 'Active'
  },
  {
    uid: 'AKRA12123', name: 'TRAINEE (SORN)', aliasUids: ['TRAINEE_SORN'], aliasNames: ['SORN'],
    roles: ['WAREHOUSE'], branches: 'AKRA', status: 'Active'
  }
]);

const currentWorkload = context.normalizeWorkloadEntry({
  employeeUid: 'AKRA12123',
  employee: 'TRAINEE (SORN)',
  capacity: 10,
  primaryCore: 'คลัง W1',
  supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }],
  outbound: 7,
  inbound: 3,
  transfer: 0,
  shared: 0
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(currentWorkload)), {
  primaryHours: 7,
  secondaryHours: 3,
  capacity: 10,
  primaryCore: 'คลัง W1',
  supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }],
  isLegacy: false
}, 'Workload v2 must report 7 hours of primary work plus 3 hours of secondary duties');

const legacyWorkload = context.normalizeWorkloadEntry({
  employee: 'SORN',
  capacity: 10,
  outbound: 4,
  inbound: 3,
  transfer: 2,
  shared: 1
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacyWorkload)), {
  primaryHours: 10,
  secondaryHours: 0,
  capacity: 10,
  primaryCore: 'ข้อมูล Workload เดิม',
  supportDuties: [],
  isLegacy: true
}, 'legacy four-bucket Workload must remain visible without inventing secondary-duty history');

assert.strictEqual(context.normalizeWorkloadEntry({
  employee: 'Legacy Partial', capacity: 10,
  outbound: 4, inbound: 0, transfer: 0, shared: 0
}).primaryHours, 4, 'legacy normalization must preserve recorded bucket totals instead of filling unused capacity');

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.resolveWorkloadEmployee(
    { employeeUid: 'TRAINEE_SORN', employee: 'SORN' },
    context.GLOBAL_CONFIG_LIST
  ))),
  { uid: 'AKRA12123', name: 'TRAINEE (SORN)' },
  'historical Workload identity must resolve through verified aliases to the canonical Main account'
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.resolveWorkloadEmployee(
    { employeeUid: 'DIFFERENT-UID', employee: 'TRAINEE (SORN)' },
    context.GLOBAL_CONFIG_LIST
  ))),
  { uid: 'DIFFERENT-UID', name: 'TRAINEE (SORN)' },
  'a different stable UID must not merge into the canonical employee by display name alone'
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getCanonicalWorkloadEntry({
    employeeUid: 'TRAINEE_SORN',
    employee: 'SORN',
    capacity: 10,
    primaryCore: 'คลัง W1',
    supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }]
  }, context.GLOBAL_CONFIG_LIST))),
  {
    uid: 'AKRA12123',
    name: 'TRAINEE (SORN)',
    primaryHours: 7,
    secondaryHours: 3,
    capacity: 10,
    primaryCore: 'คลัง W1',
    supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }],
    isLegacy: false
  },
  'one canonical adapter must combine stable identity and Workload v2 hours for every consumer'
);

const dedupedEntries = context.getCanonicalWorkloadEntries([
  {
    employeeUid: 'TRAINEE_SORN', employee: 'SORN', capacity: 10,
    outbound: 4, inbound: 0, transfer: 0, shared: 0,
    updatedAt: '2026-08-24T08:00:00Z'
  },
  {
    employeeUid: 'AKRA12123', employee: 'TRAINEE (SORN)', capacity: 10,
    primaryCore: 'คลัง W1', supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }],
    updatedAt: '2026-08-24T09:00:00Z'
  }
], context.GLOBAL_CONFIG_LIST);
assert.strictEqual(dedupedEntries.length, 1, 'one day must contain one canonical Workload entry per Main UID');
assert.deepStrictEqual(
  { uid: dedupedEntries[0].uid, primaryHours: dedupedEntries[0].primaryHours, secondaryHours: dedupedEntries[0].secondaryHours },
  { uid: 'AKRA12123', primaryHours: 7, secondaryHours: 3 },
  'the latest canonical record must replace its older legacy alias without adding hours twice'
);

assert.strictEqual(context.getEmployeeWorkloadStatus(
  context.GLOBAL_CONFIG_LIST[0],
  {
    date: '2026-08-24',
    recordedEmployees: [],
    recordedEmployeeUids: ['AKRA12123']
  },
  '2026-08-24',
  19
).state, 'recorded', 'Workload status must use the stable Main UID before mutable display names');

context.renderAkraWorkloadEditor([
  { employeeUid: 'PEER', employee: 'Peer', primaryCore: 'คลัง W2', supportDuties: [{ name: 'ช่วยย้ายของ W2', hours: 5 }] },
  { employeeUid: 'TRAINEE_SORN', employee: 'SORN', primaryCore: 'รับสินค้าเข้า', supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }] }
]);
assert.strictEqual(context.workloadState.core, 'รับสินค้าเข้า', 'editor hydration must select self through the verified UID alias');
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.workloadState.support)), [{ name: 'แวะขึ้นของ', hours: 3 }]);
context.renderAkraWorkloadEditor([
  { employeeUid: 'PEER', employee: 'Peer', primaryCore: 'คลัง W2', supportDuties: [{ name: 'ช่วยย้ายของ W2', hours: 5 }] }
]);
assert.strictEqual(context.workloadState.core, 'คลัง W1', 'editor hydration must reset when no unambiguous self record exists');
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.workloadState.support)), []);

const currentWeekDate = context.getStartOfWeek(new Date()).toISOString().slice(0, 10);
const trend = context.computeWorkloadTrend([{
  date: currentWeekDate,
  workload: [
    {
      employeeUid: 'TRAINEE_SORN', employee: 'SORN', capacity: 10,
      outbound: 4, inbound: 0, transfer: 0, shared: 0,
      updatedAt: '2026-08-24T08:00:00Z'
    },
    {
      employeeUid: 'AKRA12123', employee: 'TRAINEE (SORN)', capacity: 10,
      primaryCore: 'คลัง W1', supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }],
      outbound: 7, inbound: 3, transfer: 0, shared: 0,
      updatedAt: '2026-08-24T09:00:00Z'
    }
  ]
}], 1);
assert.deepStrictEqual(
  { primaryHours: trend[0].primaryHours, secondaryHours: trend[0].secondaryHours, capacity: trend[0].capacity },
  { primaryHours: 7, secondaryHours: 3, capacity: 10 },
  'Workload trend must use the same primary/secondary normalizer as the normal Dashboard'
);

const executive = context.aggregateDescriptivePeriod([{
  date: currentWeekDate,
  sourceBranch: 'AKRA',
  workload: [
    { employeeUid: 'TRAINEE_SORN', employee: 'SORN', capacity: 10, outbound: 4, updatedAt: '2026-08-24T08:00:00Z' },
    {
      employeeUid: 'AKRA12123', employee: 'TRAINEE (SORN)', capacity: 10,
      primaryCore: 'คลัง W1', supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }],
      updatedAt: '2026-08-24T09:00:00Z'
    }
  ]
}], 'AKRA', 1);
assert.strictEqual(executive.workloadCapacity, 10, 'Executive Workload capacity must not double-count a verified UID alias');

console.log('KPI Workload identity and Dashboard alignment behavior passed.');
