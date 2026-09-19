const assert = require('assert');
const kpiClient = require('../js/supabase-kpi-client.js');

async function runTests() {
  console.log('=== TESTING KPITRACKER AUTHENTICATED SUPABASE API CLIENT ===\n');

  // 1. Daily compatibility save must use the authenticated daily section API.
  console.log('[1/7] Testing Daily compatibility save uses section RPC actions...');
  const originalFetch = global.fetch;
  const dailyCalls = [];
  const sectionRevisions = { operations: 0, tasks: 0, endOfShift: 0, vendorBills: 0 };
  global.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    dailyCalls.push(request);
    if (request.action === 'getDailyData') {
      return { ok: true, json: async () => ({ status: 'success', records: [{ date: '2026-08-23', sectionRevisions }], nextCursor: null }) };
    }
    if (request.action === 'saveSection') {
      sectionRevisions[request.section] += 1;
      return { ok: true, json: async () => ({ status: 'success', record: { date: request.date, sectionRevisions: { ...sectionRevisions } } }) };
    }
    if (request.action === 'saveWorkload') return { ok: true, json: async () => ({ status: 'success', workload: [] }) };
    return { ok: true, json: async () => ({ status: 'success' }) };
  };
  const dailyResult = await kpiClient.saveDailyRecord({
    branch: 'AKRA', date: '2026-08-23',
    volume: { transfer: 1, pickup: 2, upcountry: 3, inmarket: 4, outmarket: 5 },
    customerNotes: 'daily compatibility', tasks: [{ taskName: 'ตรวจงาน', status: 'เสร็จแล้ว', assignee: 'A' }],
    endOfShift: { summary: 'ปิดงาน', issues: '', actions: '', followUps: '', vendorBills: { totalToday: 2, entryStatus: 'completed', pendingAccumulated: 0, pendingNote: '' } },
    workload: [{ employeeUid: 'AKRA12123', employee: 'A', capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0, primaryCore: 'คลัง W1', supportDuties: [] }]
  }, 'signed-main-token');
  assert.strictEqual(dailyResult.status, 'success');
  assert.deepStrictEqual(dailyCalls.map(call => call.action), ['getDailyData', 'saveSection', 'saveSection', 'saveSection', 'saveSection', 'saveWorkload']);
  assert.deepStrictEqual(dailyCalls.slice(1, 5).map(call => call.section), ['operations', 'tasks', 'endOfShift', 'vendorBills']);
  assert.strictEqual(dailyCalls.at(-1).employeeUid, 'AKRA12123');
  console.log('  -> saveDailyRecord routed operations/tasks/endOfShift/vendorBills through kpi-api');

  // A legacy errors payload must never be silently dropped while the active
  // Incident catalog mapping is unresolved.
  await assert.rejects(
    () => kpiClient.saveDailyRecord({
      branch: 'AKRA', date: '2026-08-23', errors: [{ emp: 'A', type: 'legacy', note: 'old shape' }]
    }, 'signed-main-token'),
    /legacy_errors_not_supported/,
    'legacy errors must fail closed instead of being silently omitted'
  );
  console.log('  -> legacy errors fail closed before any partial daily write');

  // 2. Weekly Records must read the same paginated daily projection.
  console.log('\n[2/7] Testing Weekly Records query uses authenticated daily read...');
  global.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    assert.strictEqual(request.action, 'getDailyData');
    assert.strictEqual(request.startDate, '2026-08-17');
    assert.strictEqual(request.endDate, '2026-08-23');
    assert.strictEqual(request.includeActivity, true);
    return { ok: true, json: async () => ({ status: 'success', records: [{ date: '2026-08-23' }], nextCursor: null }) };
  };
  const weekly = await kpiClient.getWeeklyRecords('signed-main-token', 'AKRA', '2026-08-17', '2026-08-23');
  assert.deepStrictEqual(weekly, [{ date: '2026-08-23' }]);
  console.log('  -> getWeeklyRecords uses getDailyData pagination without a legacy provider');

  await assert.rejects(() => kpiClient.fetchBranchData('', 'AKRA'), /authenticated/);

  // 4. Employee roster/config must use the authenticated Edge boundary.
  console.log('\n[4/7] Testing authenticated getConfig Edge request...');
  let capturedRequest;
  global.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return {
      ok: true,
      json: async () => ({
        status: 'success',
        employees: [{
          uid: 'AKRA12123', name: 'TRAINEE (SORN)', roles: ['AKRA'], branches: 'AKRA', status: 'Active',
          aliasUids: ['TRAINEE_SORN'], aliasNames: ['SORN']
        }],
        workload: { date: '2026-08-23', hour: 18, recordedEmployees: [] }
      })
    };
  };
  const result = await kpiClient.getConfig('signed-main-token');
  assert.strictEqual(result.employees[0].uid, 'AKRA12123');
  assert.strictEqual(result.employees[0].name, 'TRAINEE (SORN)');
  assert.ok(capturedRequest.url.endsWith('/functions/v1/kpi-api'));
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), { action: 'getConfig', token: 'signed-main-token' });
  const employees = await kpiClient.getEmployees('signed-main-token');
  assert.deepStrictEqual(employees, result.employees);
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), { action: 'getConfig', token: 'signed-main-token' });
  await kpiClient.getAdminStatus('signed-main-token');
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), { action: 'getAdminStatus', token: 'signed-main-token' });
  console.log('\n[5/7] Testing authenticated Workload self-save Edge request...');
  global.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return { ok: true, json: async () => ({ status: 'success', workload: [] }) };
  };
  await kpiClient.saveWorkload('signed-main-token', '250007', '2026-08-23', {
    employee: 'ชื่อจากหน้าจอ', capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0
  });
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), {
    action: 'saveWorkload', token: 'signed-main-token', employeeUid: '250007', date: '2026-08-23',
    workload: { employee: 'ชื่อจากหน้าจอ', capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0 }
  });
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'success' }) });
  await assert.rejects(
    () => kpiClient.saveWorkload('signed-main-token', '250007', '2026-08-23', {
      capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0
    }),
    /invalid_kpi_workload_response/,
    'malformed Workload save response must fail closed'
  );

  console.log('\n[6/7] Testing authenticated Workload read Edge request...');
  global.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return { ok: true, json: async () => ({ status: 'success', records: [{ date: '2026-08-23', workload: [] }] }) };
  };
  const workloadData = await kpiClient.getWorkloadData('signed-main-token', 'AKRA', 3);
  assert.strictEqual(workloadData.records[0].date, '2026-08-23');
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), {
    action: 'getWorkloadData', token: 'signed-main-token', branch: 'AKRA', months: 3
  });

  console.log('\n[6b/7] Testing authenticated Incident write/read Edge requests...');
  global.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return {
      ok: true,
      json: async () => ({ status: 'success', incidents: [{ caseId: 'ERR-1' }], zeroConfirmed: false, errors: [] })
    };
  };
  await kpiClient.saveIncident('signed-main-token', 'TRD', '2026-08-24', {
    kind: 'case', caseId: 'ERR-1', worker: 'ท็อป'
  });
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), {
    action: 'saveIncident', token: 'signed-main-token', branch: 'TRD', date: '2026-08-24',
    incident: { kind: 'case', caseId: 'ERR-1', worker: 'ท็อป' }
  });
  global.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return { ok: true, json: async () => ({ status: 'success', records: [{ date: '2026-08-24', incidents: [] }] }) };
  };
  await kpiClient.getIncidentData('signed-main-token', 'TRD', 3);
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), {
    action: 'getIncidentData', token: 'signed-main-token', branch: 'TRD', months: 3
  });
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', zeroConfirmed: false }) });
  await assert.rejects(
    () => kpiClient.saveIncident('signed-main-token', 'TRD', '2026-08-24', {}),
    /invalid_kpi_incident_response/,
    'malformed Incident save response must fail closed'
  );
  global.fetch = originalFetch;
  await assert.rejects(() => kpiClient.getConfig(''), /authenticated Main session/);
  console.log('  -> getConfig used the signed Main token and returned the Edge response');

  await assert.rejects(() => kpiClient.saveAction('', { branch: 'AKRA' }), /authenticated/);

  console.log('\n🌟 ALL KPITRACKER SUPABASE CONTAINMENT & FALLBACK TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
