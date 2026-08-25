const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = htmlContent.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = htmlContent.indexOf('{', start);
  let depth = 1;
  for (let index = open + 1; index < htmlContent.length; index++) {
    if (htmlContent[index] === '{') depth++;
    if (htmlContent[index] === '}' && --depth === 0) return htmlContent.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

// 1. Test fallback arrays directly from index.html (before and after edit)
{
  const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'script tag must exist in index.html');
  const fullScript = scriptMatch[1];

  // Evaluate variable declarations in isolated context
  const context = vm.createContext({
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { href: 'http://localhost/KPITracker/', search: '' },
    URLSearchParams: global.URLSearchParams,
    URL: global.URL,
    document: {
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      getElementById: () => null,
      querySelectorAll: () => []
    },
    window: {},
    setInterval: () => {},
    setTimeout: () => {}
  });

  // Extract and run helper functions and config definitions
  [
    'isEmployeeActive',
    'renderHistoricalEmployeeBadge',
    'normalizeEmpName',
    'getBranchesFromMainRoles',
    'normalizeMainEmployeeStatus',
    'dedupeConfigList',
    'processConfigList',
    'getBranchRosterEmployees',
    'getAkraOnDutyRoster',
    'getAkraOnDutyEmployees',
    'getBranchActiveRoster',
    'normalizeWorkloadEntry',
    'resolveWorkloadEmployee',
    'getCanonicalWorkloadEntry',
    'getCanonicalWorkloadEntries'
  ].forEach(name => vm.runInContext(extractFunction(name), context));

  // Run initial script up to HP_PENALTY
  const setupBlock = fullScript.slice(0, fullScript.indexOf('const HP_PENALTY ='));
  vm.runInContext(setupBlock, context);

  const globalConfigList = vm.runInContext('GLOBAL_CONFIG_LIST', context);
  const userDb = vm.runInContext('USER_DB', context);
  const branchConfig = vm.runInContext('BRANCH_CONFIG', context);

  // Assert fallback configurations do NOT contain 'เอส'
  const fallbackGlobalEmps = Array.from(globalConfigList, e => e.name);
  assert.ok(!fallbackGlobalEmps.includes('เอส'),
    `fallback GLOBAL_CONFIG_LIST must NOT contain "เอส", but found: ${JSON.stringify(fallbackGlobalEmps)}`);
  
  const fallbackGlobalUids = Array.from(globalConfigList, e => e.uid);
  assert.ok(!fallbackGlobalUids.includes('เอส'),
    `fallback GLOBAL_CONFIG_LIST UIDs must NOT contain "เอส", but found: ${JSON.stringify(fallbackGlobalUids)}`);

  assert.strictEqual(userDb['เอส'], undefined,
    'fallback USER_DB must NOT contain "เอส"');

  const fallbackAkraEmps = Array.from(branchConfig.AKRA.employees);
  assert.ok(!fallbackAkraEmps.includes('เอส'),
    `fallback BRANCH_CONFIG.AKRA.employees must NOT contain "เอส", but found: ${JSON.stringify(fallbackAkraEmps)}`);

  // 2. Test authenticated projection without 'เอส'
  vm.runInContext(`
    processConfigList([
      { uid: 'AKRA12123', name: 'TRAINEE (SORN)', roles: ['AKRA'], status: 'Active' },
      { uid: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' },
      { uid: '250010', name: 'เอี้ยง', roles: ['AKRA'], status: 'Active' },
      { uid: '260030', name: 'จอนห์นี่', roles: ['AKRA'], status: 'Active' },
      { uid: '260029', name: 'ปีเตอร์', roles: ['AKRA'], status: 'Active' }
    ]);
  `, context);

  const activeAkraEmps = Array.from(vm.runInContext('BRANCH_CONFIG.AKRA.employees', context));
  assert.deepStrictEqual(activeAkraEmps, ['TRAINEE (SORN)', 'หมูหยอง', 'เอี้ยง', 'จอนห์นี่', 'ปีเตอร์'],
    'authenticated AKRA active roster must contain only legitimate Main employees and omit "เอส"');

  assert.strictEqual(vm.runInContext('isEmployeeActive("เอส")', context), false,
    'isEmployeeActive("เอส") must return false');

  const badge = vm.runInContext('renderHistoricalEmployeeBadge("เอส")', context);
  assert.ok(badge.includes('อดีตพนักงาน'),
    'renderHistoricalEmployeeBadge("เอส") must return former-employee badge for historical preservation');

  // 3. Test active roster accessor
  const activeRoster = Array.from(vm.runInContext('getBranchActiveRoster("AKRA")', context));
  assert.ok(!activeRoster.includes('เอส'),
    'getBranchActiveRoster("AKRA") must NOT contain "เอส"');

  // 4. Test historical workload resolution
  const resolved = JSON.parse(JSON.stringify(
    vm.runInContext('resolveWorkloadEmployee({ employeeUid: "เอส", employee: "เอส" }, GLOBAL_CONFIG_LIST)', context)
  ));
  assert.deepStrictEqual(resolved, { uid: 'เอส', name: 'เอส' },
    'unconfigured historical workload employee must preserve historical label without crashing');

  console.log('PASS: Synthetic employee "เอส" retirement test passed across fallback, authenticated, and historical flows.');
}
