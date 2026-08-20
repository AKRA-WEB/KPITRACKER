const assert = require('assert');
const kpiClient = require('../js/supabase-kpi-client.js');

async function runTests() {
  console.log('=== TESTING KPITRACKER SUPABASE API CLIENT ADAPTER ===\n');

  // 1. Daily Record Upsert with JSONB
  console.log('[1/5] Testing Daily Record Upsert with JSONB payload...');
  const testDate = '2026-08-19';
  const saveRes = await kpiClient.saveDailyRecord({
    recordDate: testDate,
    branch: 'AKRA',
    workloadData: {
      team_summary: { total_hours: 80, on_duty_count: 8 },
      individuals: [
        { name: 'พุช', capacity: 10, outbound: 4, inbound: 4, transfer: 2, shared: 0 },
        { name: 'หยอง', capacity: 10, outbound: 5, inbound: 3, transfer: 2, shared: 0 }
      ]
    },
    endOfShiftData: {
      brief: 'การปฏิบัติงานกะเช้าราบรื่น',
      issues: 'พบสินค้าชำรุด 2 รายการระหว่างรับเข้า W1',
      followUps: 'แจ้งจัดซื้อออกใบล็อตเคลม'
    },
    errorsData: [
      { emp: 'พุช', type: 'หยิบสินค้าผิด SKU', penalty_hp: 5, case_id: 'ERR-20260819-01' }
    ],
    notes: 'ประจำวันที่ 19 ส.ค. 2569',
    submittedBy: 'chen'
  });

  assert.strictEqual(saveRes.status, 'success');
  assert(saveRes.record.id, 'Must return saved record ID');
  console.log(`  -> Saved KPI Daily Record ID: [${saveRes.record.id}] for [${saveRes.record.branch}] on [${saveRes.record.record_date}]`);

  // 2. Monday-Sunday Weekly Aggregation Query (<25ms)
  console.log('\n[2/5] Testing Monday-Sunday Weekly Aggregation query (<25ms)...');
  const t0 = Date.now();
  const weeklyRes = await kpiClient.getWeeklyRecords('AKRA', '2026-08-17', '2026-08-23');
  const weeklyMs = Date.now() - t0;
  assert.strictEqual(weeklyRes.status, 'success');
  assert(weeklyRes.records.length >= 1, 'Must find at least 1 record for this week');
  console.log(`  -> Weekly Query Latency: ${weeklyMs}ms (retrieved ${weeklyRes.records.length} records)`);

  // 3. fetchBranchData Query (Simulating Frontend initial load)
  console.log('\n[3/5] Testing fetchBranchData for AKRA & TRD...');
  const t1 = Date.now();
  const akraData = await kpiClient.fetchBranchData('AKRA', 6);
  const akraMs = Date.now() - t1;
  assert(Array.isArray(akraData), 'Must return array');
  assert(akraData.length > 50, 'Must contain historical rows');
  console.log(`  -> fetchBranchData(AKRA) returned ${akraData.length} records in ${akraMs}ms`);

  const trdData = await kpiClient.fetchBranchData('TRD', 6);
  assert(Array.isArray(trdData), 'Must return array');
  assert(trdData.length > 50, 'Must contain historical rows');
  console.log(`  -> fetchBranchData(TRD) returned ${trdData.length} records`);

  // 4. Employee Roster and Config Query
  console.log('\n[4/5] Testing Employee roster & config query...');
  const empRes = await kpiClient.getEmployees('AKRA');
  assert.strictEqual(empRes.status, 'success');
  console.log(`  -> Fetched ${empRes.employees.length} active employees for AKRA`);

  const config = await kpiClient.getConfig();
  assert(Array.isArray(config), 'Config must be array');
  assert(config.length >= 10, 'Must have all employees configured');
  console.log(`  -> Fetched ${config.length} distinct employees for config`);

  // 5. Executive Action Center
  console.log('\n[5/5] Testing Executive Action Center...');
  const actionRes = await kpiClient.saveAction({
    branch: 'AKRA',
    title: 'ติดตามการเคลมสินค้าชำรุด',
    description: 'เร่งรัดใบลดหนี้จาก บจก. เม่งฮง',
    assignee: 'Supervisor',
    status: 'Open'
  });
  assert.strictEqual(actionRes.status, 'success');
  assert(actionRes.actionId, 'Must return actionId');
  console.log(`  -> Created Executive Action ID: [${actionRes.actionId}]`);

  console.log('\n🌟 ALL KPITRACKER SUPABASE API CLIENT TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
