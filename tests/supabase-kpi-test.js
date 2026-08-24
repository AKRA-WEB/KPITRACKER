const assert = require('assert');
const kpiClient = require('../js/supabase-kpi-client.js');

async function runTests() {
  console.log('=== TESTING KPITRACKER SUPABASE API CLIENT CONTAINMENT & FALLBACK ===\n');

  // 1. Daily Record Upsert with JSONB should throw containment error
  console.log('[1/7] Testing Daily Record Upsert throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.saveDailyRecord({ branch: 'AKRA' }); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> saveDailyRecord correctly deactivated with fallback notice');

  // 2. Weekly Records should throw containment error
  console.log('\n[2/7] Testing Weekly Records query throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.getWeeklyRecords('AKRA', '2026-08-17', '2026-08-23'); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> getWeeklyRecords correctly deactivated with fallback notice');

  // 3. fetchBranchData Query should throw containment error
  console.log('\n[3/7] Testing fetchBranchData throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.fetchBranchData('AKRA', 6); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> fetchBranchData correctly deactivated with fallback notice');

  // 4. Employee roster/config must use the authenticated Edge boundary.
  console.log('\n[4/7] Testing authenticated getConfig Edge request...');
  const originalFetch = global.fetch;
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
  global.fetch = originalFetch;
  await assert.rejects(() => kpiClient.getConfig(''), /authenticated Main session/);
  console.log('  -> getConfig used the signed Main token and returned the Edge response');

  // 5. Executive Action Center should throw containment error
  console.log('\n[7/7] Testing saveAction throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.saveAction({ branch: 'AKRA' }); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> saveAction correctly deactivated with fallback notice');

  console.log('\n🌟 ALL KPITRACKER SUPABASE CONTAINMENT & FALLBACK TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
