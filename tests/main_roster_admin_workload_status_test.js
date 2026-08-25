const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const asyncSignature = `async function ${name}`;
  const signature = `function ${name}`;
  const asyncStart = html.indexOf(asyncSignature);
  const start = asyncStart >= 0 ? asyncStart : html.indexOf(signature);
  if (start < 0) throw new Error(`${name} not found`);
  const open = html.indexOf('{', start);
  let depth = 1;
  let index = open + 1;
  while (depth > 0 && index < html.length) {
    if (html[index] === '{') depth++;
    if (html[index] === '}') depth--;
    index++;
  }
  return html.slice(start, index);
}

[
  'normalizeEmpName',
  'getBranchesFromMainRoles',
  'canAccessAdminSettings',
  'getKpiBangkokClock',
  'getEmployeeWorkloadStatus',
  'normalizeMainEmployeeStatus',
  'getPreviousKpiDate'
].forEach(name => vm.runInThisContext(extractFunction(name)));

assert.deepStrictEqual(getBranchesFromMainRoles(['WAREHOUSE']), ['AKRA']);
assert.deepStrictEqual(getBranchesFromMainRoles(['Cashier']), ['TRD']);
assert.deepStrictEqual(getBranchesFromMainRoles(['SUPERVISOR']), ['AKRA', 'TRD']);
assert.deepStrictEqual(getBranchesFromMainRoles(['ADMIN']), ['AKRA', 'TRD']);
assert.deepStrictEqual(getBranchesFromMainRoles(['AKRA', 'TRD']), ['AKRA', 'TRD']);

assert.strictEqual(canAccessAdminSettings(['ADMIN'], true), true);
assert.strictEqual(canAccessAdminSettings(['Admin'], true), true);
assert.strictEqual(canAccessAdminSettings(['SUPERVISOR'], true), false);
assert.strictEqual(canAccessAdminSettings(['ADMIN'], false), false);
assert.strictEqual(normalizeMainEmployeeStatus('Active'), 'Active');
assert.strictEqual(normalizeMainEmployeeStatus('active'), 'Active');
assert.strictEqual(normalizeMainEmployeeStatus('Inactive'), 'Inactive');
assert.strictEqual(normalizeMainEmployeeStatus('Suspended'), 'Suspended');
assert.strictEqual(normalizeMainEmployeeStatus(''), 'Inactive');

assert.deepStrictEqual(
  getKpiBangkokClock(new Date('2026-08-22T18:00:00.000Z')),
  { date: '2026-08-23', hour: 1 },
  'Bangkok date must not fall back to the previous UTC date before 07:00'
);

const snapshot = { date: '2026-08-23', recordedEmployees: ['Somchai'] };
const akraEmployee = { uid: '250001', name: 'Somchai', roles: ['WAREHOUSE'], branches: 'AKRA', status: 'Active' };
const missingEmployee = { uid: '250002', name: 'Somsri', roles: ['AKRA'], branches: 'AKRA', status: 'Active' };

assert.strictEqual(getEmployeeWorkloadStatus(akraEmployee, snapshot, '2026-08-23', 18).state, 'recorded');
assert.strictEqual(getEmployeeWorkloadStatus(missingEmployee, snapshot, '2026-08-23', 17).state, 'pending');
assert.strictEqual(getEmployeeWorkloadStatus(missingEmployee, snapshot, '2026-08-23', 23).state, 'pending');
assert.strictEqual(getEmployeeWorkloadStatus(missingEmployee, {
  date: '2026-08-24',
  recordedEmployees: [],
  previousDate: '2026-08-23',
  previousRecordedEmployees: []
}, '2026-08-24', 0).state, 'missing');
assert.strictEqual(getEmployeeWorkloadStatus(missingEmployee, {
  date: '2026-08-24',
  recordedEmployees: [],
  previousDate: '2026-08-23',
  previousRecordedEmployees: ['Somsri']
}, '2026-08-24', 0).state, 'pending');
assert.strictEqual(getEmployeeWorkloadStatus({ ...missingEmployee, roles: ['TRD'], branches: 'TRD' }, snapshot, '2026-08-23', 19).state, 'not_required');
assert.strictEqual(getEmployeeWorkloadStatus({ ...missingEmployee, roles: ['ADMIN'], branches: 'AKRA,TRD' }, snapshot, '2026-08-23', 19).state, 'not_required');
assert.strictEqual(getEmployeeWorkloadStatus({ ...missingEmployee, status: 'Inactive' }, snapshot, '2026-08-23', 19).state, 'inactive');
assert.match(getEmployeeWorkloadStatus({ ...missingEmployee, status: 'Suspended' }, snapshot, '2026-08-23', 19).label, /Suspended/);
assert.strictEqual(getEmployeeWorkloadStatus(missingEmployee, snapshot, '2026-08-24', 19).state, 'unavailable');
assert.strictEqual(getEmployeeWorkloadStatus(akraEmployee, snapshot, '2026-08-24', 0).state, 'unavailable');
assert.strictEqual(getPreviousKpiDate('2026-08-24'), '2026-08-23');
assert.strictEqual(getEmployeeWorkloadStatus(missingEmployee, {
  date: '2026-08-24',
  recordedEmployees: [],
  previousDate: '2026-08-22',
  previousRecordedEmployees: []
}, '2026-08-24', 0).state, 'unavailable');

function verifySuspendedAdminRendering() {
  const elements = {
    'admin-employee-list': { innerHTML: '' },
    'admin-workload-summary': { textContent: '' },
    'admin-emp-count': { innerText: '' }
  };
  const context = vm.createContext({
    IS_ADMIN: true,
    GLOBAL_CONFIG_LIST: [{ uid: '250099', name: 'พักใช้งาน', roles: ['WAREHOUSE'], branches: 'AKRA', status: 'Suspended' }],
    KPI_WORKLOAD_STATUS: { date: '2026-08-23', recordedEmployees: [] },
    document: { getElementById: id => elements[id] || null },
    getKpiBangkokClock: () => ({ date: '2026-08-23', hour: 12 }),
    getEmployeeWorkloadStatus,
    esc: value => String(value ?? '')
  });
  vm.runInContext(extractFunction('renderAdminPanel'), context);
  assert.strictEqual(context.renderAdminPanel(), true);
  assert.match(elements['admin-employee-list'].innerHTML, /สถานะจาก Main: <strong>Suspended<\/strong>/);
  assert.match(elements['admin-employee-list'].innerHTML, /Suspended · ไม่อยู่ในสถานะทำงาน/);
}

async function verifyAdminStatusRefresh() {
  let requestCount = 0;
  let resolveFirst;
  const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
  const api = {
    getAdminStatus: async () => {
      requestCount++;
      if (requestCount === 1) return firstResponse;
      return {
        employees: [missingEmployee],
        workload: { date: '2026-08-23', hour: 19, recordedEmployees: ['Somsri'] }
      };
    }
  };
  const summaryElement = { textContent: '' };
  const context = vm.createContext({
    console,
    IS_ADMIN: true,
    sessionToken: 'signed-token',
    window: { AkraSupabaseKPI: api },
    AkraSupabaseKPI: api,
    adminStatusRequest: null,
    KPI_MAIN_VIEWER: null,
    KPI_WORKLOAD_STATUS: {},
    document: { getElementById: () => summaryElement },
    processConfigList: employees => { context.processedEmployees = employees; },
    renderAdminPanel: () => { context.renderCount = (context.renderCount || 0) + 1; },
    updateDrawerUserInfo: () => {},
    switchTab: () => {},
    showToast: () => {}
  });
  vm.runInContext(extractFunction('refreshAdminStatus'), context);

  const first = context.refreshAdminStatus();
  const overlapping = context.refreshAdminStatus();
  assert.strictEqual(requestCount, 1, 'overlapping refreshes must share one Edge request');
  resolveFirst({
    employees: [missingEmployee],
    workload: { date: '2026-08-23', hour: 17, recordedEmployees: [] }
  });
  await Promise.all([first, overlapping]);
  assert.deepStrictEqual(Array.from(context.KPI_WORKLOAD_STATUS.recordedEmployees), []);

  await context.refreshAdminStatus();
  assert.strictEqual(requestCount, 2, 'opening/polling again must fetch a fresh Workload snapshot');
  assert.deepStrictEqual(Array.from(context.KPI_WORKLOAD_STATUS.recordedEmployees), ['Somsri']);
  assert.strictEqual(context.renderCount, 2);
}

async function verifyLiveAdminRevocation() {
  const denied = new Error('invalid_or_expired_token');
  const context = vm.createContext({
    console: { warn: () => {} },
    IS_ADMIN: true,
    sessionToken: 'stale-admin-token',
    currentRoles: ['ADMIN'],
    _kpiPerms: ['adminDashboard'],
    window: { AkraSupabaseKPI: { getAdminStatus: async () => { throw denied; } } },
    AkraSupabaseKPI: { getAdminStatus: async () => { throw denied; } },
    adminStatusRequest: null,
    KPI_MAIN_VIEWER: { roles: ['ADMIN'] },
    KPI_WORKLOAD_STATUS: {},
    GLOBAL_CONFIG_LIST: [
      { uid: 'active', name: 'Active', status: 'Active' },
      { uid: 'inactive', name: 'Inactive', status: 'Inactive' }
    ],
    document: { getElementById: () => ({ textContent: '' }) },
    processConfigList: employees => { context.remainingEmployees = employees; },
    renderAdminPanel: () => {}, showToast: () => {},
    safeStorage: { removeItem: key => { context.removedKeys = [...(context.removedKeys || []), key]; } },
    startAdminStatusRefresh: () => { context.pollingStopped = context.IS_ADMIN === false; },
    updateDrawerUserInfo: () => {
      context.drawerSawAdmin = context.IS_ADMIN || context.currentRoles.some(role => String(role).toUpperCase() === 'ADMIN');
    },
    switchTab: tab => { context.redirectedTab = tab; }
  });
  vm.runInContext(extractFunction('refreshAdminStatus'), context);
  assert.strictEqual(await context.refreshAdminStatus(), false);
  assert.strictEqual(context.IS_ADMIN, false);
  assert.strictEqual(context.currentRoles.includes('ADMIN'), false);
  assert.deepStrictEqual(Array.from(context._kpiPerms), []);
  assert.strictEqual(context.sessionToken, null);
  assert.deepStrictEqual(Array.from(context.remainingEmployees, employee => employee.uid), ['active']);
  assert.deepStrictEqual(Array.from(context.KPI_WORKLOAD_STATUS.recordedEmployees), []);
  assert.strictEqual(context.pollingStopped, true);
  assert.strictEqual(context.drawerSawAdmin, false, 'live role revocation must hide Admin Settings');
  assert.strictEqual(context.redirectedTab, 'workload');
}

function verifyVisibleAdminPolling() {
  const adminView = { classList: { contains: () => false } };
  const context = vm.createContext({
    IS_ADMIN: true,
    adminStatusRefreshTimer: null,
    refreshCount: 0,
    clearCount: 0,
    document: { getElementById: () => adminView },
    refreshAdminStatus: () => { context.refreshCount++; },
    setInterval: (callback, delay) => {
      context.intervalCallback = callback;
      context.intervalDelay = delay;
      return 42;
    },
    clearInterval: timer => {
      assert.strictEqual(timer, 42);
      context.clearCount++;
    }
  });
  vm.runInContext(extractFunction('startAdminStatusRefresh'), context);
  context.startAdminStatusRefresh();
  assert.strictEqual(context.intervalDelay, 60000);
  context.intervalCallback();
  assert.strictEqual(context.refreshCount, 1, 'visible Admin Settings must poll for fresh Workload state');
  context.IS_ADMIN = false;
  context.startAdminStatusRefresh();
  assert.strictEqual(context.clearCount, 1, 'revoked Admin privilege must clear the polling timer');
  assert.strictEqual(context.adminStatusRefreshTimer, null);
}

async function verifyWorkloadRoleAuthority() {
  const button = { innerHTML: '', disabled: false };
  const edgeSaves = [];
  const supabaseClient = {
    saveWorkload: async (token, employeeUid, date, workload) => {
      edgeSaves.push({ token, employeeUid, date, workload });
      return { status: 'success', workload: [workload] };
    }
  };
  const context = vm.createContext({
    console,
    window: { AkraSupabaseKPI: supabaseClient },
    AkraSupabaseKPI: supabaseClient,
    sessionToken: 'signed-token',
    currentUser: '250013',
    displayUserName: '250013',
    currentRoles: ['WAREHOUSE'],
    currentBranch: 'AKRA',
    AppVersionGuard: { blockIfStale: async () => false },
    document: { getElementById: id => id === 'record-date' ? { value: '2026-08-23' } : button },
    canAccessAdminSettings,
    normalizeEmpName,
    getAkraWorkloadValues: () => [
      { employee: '250013', outbound: 1, inbound: 1, transfer: 1, shared: 1, capacity: 4 },
      { employee: 'Other', outbound: 1, inbound: 1, transfer: 1, shared: 1, capacity: 4 }
    ],
    postToAppScript: async request => {
      context.savedAdminWorkloads = request.workload;
      return { status: 'success' };
    },
    showToast: () => {}, showModal: () => {}, sendAppLog: () => {},
    safeStorage: { removeItem: () => {} },
    applyWorkloadSaveResultToCache: () => {},
    renderTeamWorkloadPreview: () => {},
    syncDataFromSheet: async () => {}, loadDashboardData: () => {}, updateDailyDashboard: () => {}
  });
  vm.runInContext(extractFunction('saveWorkloadCard'), context);
  await context.saveWorkloadCard();
  assert.strictEqual(edgeSaves.length, 1, 'a non-admin must save its own Workload through the authenticated Edge boundary');
  assert.strictEqual(edgeSaves[0].employeeUid, '250013');
  assert.strictEqual(edgeSaves[0].workload.employee, '250013');
  assert.strictEqual(context.savedAdminWorkloads, undefined, 'workload save must go through Supabase rather than legacy GAS');
  context.currentRoles = ['ADMIN'];
  await context.saveWorkloadCard();
  assert.strictEqual(edgeSaves.length, 2, 'all users save workload through authenticated Supabase path');
}

verifyAdminStatusRefresh().then(() => {
  return verifyLiveAdminRevocation();
}).then(() => {
  verifyVisibleAdminPolling();
  verifySuspendedAdminRendering();
  return verifyWorkloadRoleAuthority();
}).then(() => {
  console.log('Main roster, ADMIN settings, and Workload status behavior passed.');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
