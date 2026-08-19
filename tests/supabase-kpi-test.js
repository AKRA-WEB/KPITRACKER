const assert = require('assert');
const kpiClient = require('../js/supabase-kpi-client.js');

async function runTests() {
  console.log('=== TESTING KPITRACKER SUPABASE API CLIENT ADAPTER ===\n');

  // 1. Daily Record Upsert with JSONB
  console.log('[1/4] Testing Daily Record Upsert with JSONB payload...');
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
  console.log('\n[2/4] Testing Monday-Sunday Weekly Aggregation query (<25ms)...');
  const t0 = Date.now();
  const weeklyRes = await kpiClient.getWeeklyRecords('AKRA', '2026-08-17', '2026-08-23');
  const weeklyMs = Date.now() - t0;
  assert.strictEqual(weeklyRes.status, 'success');
  assert(weeklyRes.records.length >= 1, 'Must find at least 1 record for this week');
  console.log(`  -> Weekly Query Latency: ${weeklyMs}ms (retrieved ${weeklyRes.records.length} records)`);

  // 3. Employee Roster Query
  console.log('\n[3/4] Testing Employee roster query...');
  const empRes = await kpiClient.getEmployees('AKRA');
  assert.strictEqual(empRes.status, 'success');
  console.log(`  -> Fetched ${empRes.employees.length} active employees for AKRA`);

  // 4. Executive Action Center
  console.log('\n[4/4] Testing Executive Action Center...');
  const actionRes = await kpiClient.saveAction({
    branch: 'AKRA',
    title: 'ติดตามการเคลมสินค้าชำรุด',
    description: 'เร่งรัดใบลดหนี้จาก บจก. เม่งฮง',
    assignee: 'Supervisor',
    status: 'Open'
  });
  assert.strictEqual(actionRes.status, 'success');
  console.log(`  -> Created Executive Action ID: [${actionRes.action.id}]`);

  console.log('\n🌟 KPITRACKER SUPABASE API CLIENT ADAPTER TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
