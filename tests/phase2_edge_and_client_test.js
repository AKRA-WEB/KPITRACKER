const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEdgeHandler(fixtures = {}) {
  const edgePath = path.resolve(__dirname, '..', '..', 'database', 'supabase', 'functions', 'kpi-api', 'index.ts');
  const edgeCode = fs.readFileSync(edgePath, 'utf8')
    .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^const\s+LEGACY_MAIN_VERIFY_URL\s*=.*?;/m, 'const LEGACY_MAIN_VERIFY_URL = "http://mock-legacy-main/exec";')
    .replace(/\bconst\s+branches:\s*string\[\]\s*=/g, 'const branches =')
    .replace(/\bconst\s+values:\s*Record<string,\s*string>\s*=/g, 'const values =');

  let handler = null;
  const context = {
    console,
    Date,
    Set,
    Map,
    Array,
    Object,
    Number,
    String,
    Boolean,
    JSON,
    RegExp,
    Error,
    Math,
    Intl,
    encodeURIComponent,
    fetch: async () => new Response('{}', { status: 200 }),
    Response,
    Headers,
    Request,
    Deno: {
      env: {
        get: key => {
          if (key === 'MAIN_JWT_SECRET') return 'test-jwt-secret-phase2';
          if (key === 'SUPABASE_URL') return 'http://127.0.0.1:54321';
          if (key === 'SECRET_KEY' || key === 'SUPABASE_SECRET_KEY') return 'test-service-role-key';
          if (key === 'KPI_ALLOWED_ORIGINS') return 'https://akra-web.github.io,http://localhost:3000';
          return '';
        }
      },
      serve: fn => { handler = fn; }
    },
    __KPI_API_TEST_FIXTURES__: fixtures
  };

  vm.createContext(context);
  new vm.Script(edgeCode).runInContext(context);
  assert.ok(typeof handler === 'function', 'Deno.serve handler must be registered');
  return { handler, context };
}

async function callApi(handler, payload, origin = 'https://akra-web.github.io') {
  const req = new Request('http://localhost/kpi-api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin
    },
    body: JSON.stringify(payload)
  });
  const res = await handler(req);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

(async () => {
  console.log('=== RUNNING PHASE 2 KPI-API EDGE FUNCTION & BUSINESS LOGIC TESTS ===');

  const now = new Date('2026-08-26T08:00:00.000Z');

  // Test 1: Shift Roster save and get
  console.log('[1/5] Testing Shift Roster saveShiftRoster and getShiftRoster...');
  {
    const savedRosters = [];
    const fixtures = {
      now,
      verifyMainJwt: async () => ({ id: 'AKRA12123', roles: ['AKRA', 'SUPERVISOR'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table) => {
        if (table === 'users') return [{ username: 'AKRA12123', name: 'หมูหยอง', roles: ['AKRA', 'SUPERVISOR'], status: 'Active' }];
        if (table === 'kpi_shift_records') return savedRosters;
        return [];
      },
      dbRpc: async (name, body) => {
        if (name === 'kpi_save_shift_roster_v1') {
          const shiftRoster = {
            record_date: body.p_record_date,
            branch: body.p_branch,
            shift_lead: body.p_shift_lead,
            roster_data: body.p_roster
          };
          savedRosters.push(shiftRoster);
          return { status: 'success', shift_roster: shiftRoster };
        }
        return { status: 'success' };
      }
    };
    const { handler } = loadEdgeHandler(fixtures);

    // Save roster
    const saveRes = await callApi(handler, {
      action: 'saveShiftRoster',
      token: 'valid-jwt',
      branch: 'AKRA',
      date: '2026-08-26',
      shiftLead: 'หมูหยอง',
      roster: [
        { employeeUid: 'AKRA12123', name: 'หมูหยอง', status: 'on_duty' },
        { employeeUid: 'AKRA12124', name: 'เอี้ยง', status: 'leave', note: 'ลาพักร้อน' }
      ]
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.status, 'success');
    assert.equal(saveRes.body.shiftRoster.shift_lead, 'หมูหยอง');
    assert.equal(saveRes.body.shiftRoster.roster_data.length, 2);

    // Get roster
    const getRes = await callApi(handler, {
      action: 'getShiftRoster',
      token: 'valid-jwt',
      branch: 'AKRA',
      date: '2026-08-26'
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.status, 'success');
    assert.ok(getRes.body.shiftRoster);
    assert.equal(getRes.body.shiftRoster.roster_data[1].status, 'leave');
    console.log('  -> Shift Roster endpoints verified successfully.');
  }

  // Test 2: Process & Pending Incidents (0 HP Deduction)
  console.log('[2/5] Testing Incident Responsibility Model (Process & Pending = 0 HP)...');
  {
    const fixtures = {
      now,
      verifyMainJwt: async () => ({ id: 'AKRA12123', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table) => {
        if (table === 'users') return [{ username: 'AKRA12123', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        return [];
      },
      dbRpc: async (name, body) => {
        if (name === 'kpi_save_incident_v1') {
          return { status: 'success', errors: body.p_entries };
        }
        return { status: 'success' };
      }
    };
    const { handler } = loadEdgeHandler(fixtures);

    // Test Process Error (e.g. Supplier sends late / Stock shortage due to supplier) -> 0 HP
    const processRes = await callApi(handler, {
      action: 'saveIncident',
      token: 'valid-jwt',
      branch: 'AKRA',
      date: '2026-08-26',
      incident: {
        kind: 'case',
        caseId: 'ERR-2026-08-26-PROC-01',
        worker: 'หมูหยอง',
        participants: ['หมูหยอง'],
        roster: ['หมูหยอง'],
        category: 'store_stock',
        type: 'พบสินค้าใกล้หมดแต่ไม่แจ้งตามจุด Reorder',
        responsibility: 'process', // Process Error
        stage: 'warehouse',
        penalty: 0, // Must be 0
        note: 'Supplier ส่งของช้ากว่ากำหนด 3 วัน',
        time: '11:00 น.'
      }
    });
    assert.equal(processRes.status, 200);
    assert.equal(processRes.body.incidents.length, 1);
    assert.equal(processRes.body.incidents[0].penalty, 0);
    assert.equal(processRes.body.incidents[0].responsibility, 'process');

    // Test Pending Investigation -> 0 HP
    const pendingRes = await callApi(handler, {
      action: 'saveIncident',
      token: 'valid-jwt',
      branch: 'AKRA',
      date: '2026-08-26',
      incident: {
        kind: 'case',
        caseId: 'ERR-2026-08-26-PEND-01',
        worker: 'หมูหยอง',
        participants: ['หมูหยอง'],
        roster: ['หมูหยอง'],
        category: 'outbound',
        type: 'หยิบผิด ถึงลูกค้าแล้ว',
        responsibility: 'pending', // Under investigation
        stage: 'customer',
        penalty: 0, // Must be 0 while investigating
        note: 'อยู่ระหว่างตรวจสอบภาพจากกล้องวงจรปิด',
        time: '14:30 น.'
      }
    });
    assert.equal(pendingRes.status, 200);
    assert.equal(pendingRes.body.incidents.length, 1);
    assert.equal(pendingRes.body.incidents[0].penalty, 0);
    assert.equal(pendingRes.body.incidents[0].responsibility, 'pending');

    // Test Individual Error -> Deducts penalty (e.g. 5 HP)
    const indRes = await callApi(handler, {
      action: 'saveIncident',
      token: 'valid-jwt',
      branch: 'AKRA',
      date: '2026-08-26',
      incident: {
        kind: 'case',
        caseId: 'ERR-2026-08-26-IND-01',
        worker: 'หมูหยอง',
        participants: ['หมูหยอง'],
        roster: ['หมูหยอง'],
        category: 'outbound',
        type: 'หยิบผิด แก้ทันก่อนจัดส่ง',
        responsibility: 'individual',
        stage: 'warehouse',
        penalty: 5,
        note: 'ตรวจพบที่จุดเช็คก่อนขึ้นรถ',
        time: '15:00 น.'
      }
    });
    assert.equal(indRes.status, 200);
    assert.equal(indRes.body.incidents.length, 1);
    assert.equal(indRes.body.incidents[0].penalty, 5);
    console.log('  -> Incident Responsibility Model (Process & Pending = 0 HP) verified.');
  }

  // Test 3: Monday 5S Warehouse Walk Audit Endpoints
  console.log('[3/5] Testing Monday 5S Warehouse Walk Audit Endpoints...');
  {
    const storedAudits = [];
    const storedFindings = [];
    const fixtures = {
      now,
      verifyMainJwt: async () => ({ id: 'AKRA12123', roles: ['AKRA', 'SUPERVISOR'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table) => {
        if (table === 'users') return [{ username: 'AKRA12123', name: 'หมูหยอง', roles: ['AKRA', 'SUPERVISOR'], status: 'Active' }];
        if (table === 'kpi_audit_records') return storedAudits;
        if (table === 'kpi_audit_findings') return storedFindings;
        return [];
      },
      dbRpc: async (name, body) => {
        if (name === 'kpi_save_audit_record_v1') {
          const audit = {
            id: 'audit-uuid-1',
            audit_date: body.p_audit_date,
            branch: body.p_branch,
            audit_type: body.p_audit_type,
            inspector: body.p_username,
            total_score: body.p_total_score,
            section_scores: body.p_section_scores,
            notes: body.p_notes,
            created_at: new Date().toISOString()
          };
          storedAudits.push(audit);
          if (Array.isArray(body.p_findings)) {
            body.p_findings.forEach((f, idx) => {
              storedFindings.push({
                id: `finding-${idx + 1}`,
                audit_id: 'audit-uuid-1',
                audit_date: body.p_audit_date,
                branch: body.p_branch,
                area: f.area,
                finding_text: f.finding_text,
                category: f.category,
                responsible_person: f.responsible_person,
                due_time: f.due_time,
                status: f.status,
                before_photo_url: f.before_photo_url,
                created_at: new Date().toISOString()
              });
            });
          }
          return { status: 'success', audit_id: 'audit-uuid-1', total_score: body.p_total_score };
        }
        if (name === 'kpi_update_audit_finding_v1') {
          const target = storedFindings.find(f => f.id === body.p_finding_id);
          if (target) {
            target.status = body.p_status;
            target.resolution_note = body.p_resolution_note;
            target.after_photo_url = body.p_after_photo_url;
            return { status: 'success', finding: target };
          }
        }
        return { status: 'success' };
      }
    };
    const { handler } = loadEdgeHandler(fixtures);

    // Save 5S audit
    const auditRes = await callApi(handler, {
      action: 'saveAuditRecord',
      token: 'valid-jwt',
      branch: 'AKRA',
      date: '2026-08-26',
      auditType: 'Monday 5S',
      totalScore: 95,
      sectionScores: { safety: 25, cleanliness: 20, storage: 18, location_label: 15, fifo_fefo: 10, equipment: 7 },
      notes: 'ตรวจคลัง W1 และ W2 ช่วงเช้า',
      findings: [
        { area: 'W1 โซนแพ็ค', finding_text: 'พบเศษกล่องและเทปบนพื้น', category: 'cleanliness', responsible_person: 'หมูหยอง', due_time: '12:00 น.' }
      ]
    });
    assert.equal(auditRes.status, 200);
    assert.equal(auditRes.body.status, 'success');

    // Get 5S audit
    const getAuditRes = await callApi(handler, {
      action: 'getAuditData',
      token: 'valid-jwt',
      branch: 'AKRA',
      months: 1
    });
    assert.equal(getAuditRes.status, 200);
    assert.equal(getAuditRes.body.audits.length, 1);
    assert.equal(getAuditRes.body.findings.length, 1);
    assert.equal(getAuditRes.body.findings[0].findingText, 'พบเศษกล่องและเทปบนพื้น');

    // Update 5S Finding status to Resolved
    const updateRes = await callApi(handler, {
      action: 'updateAuditFinding',
      token: 'valid-jwt',
      findingId: 'finding-1',
      status: 'Resolved',
      afterPhotoUrl: 'https://example.com/after.jpg',
      resolutionNote: 'ทำความสะอาดเรียบร้อย'
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.finding.status, 'Resolved');
    console.log('  -> Monday 5S Warehouse Walk Audit Endpoints verified.');
  }

  // Test 4: Workload Capacity (Half day 5h, OT 11-13h, Leave 0h)
  console.log('[4/5] Testing Workload Capacity Flex (Half Day, OT, Leave)...');
  {
    const fixtures = {
      now,
      verifyMainJwt: async () => ({ id: 'AKRA12123', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table) => {
        if (table === 'users') return [{ username: 'AKRA12123', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        return [];
      },
      dbRpc: async (name, body) => {
        if (name === 'kpi_save_workload_entry_v1') {
          return { status: 'success', workload: [body.p_entry] };
        }
        return { status: 'success' };
      }
    };
    const { handler } = loadEdgeHandler(fixtures);

    // Save half day workload (5h)
    const halfDayRes = await callApi(handler, {
      action: 'saveWorkload',
      token: 'valid-jwt',
      date: '2026-08-26',
      workload: {
        capacity: 5,
        outbound: 5,
        inbound: 0,
        transfer: 0,
        shared: 0,
        primaryCore: 'ขาออก',
        supportDuties: []
      }
    });
    assert.equal(halfDayRes.status, 200);
    assert.equal(halfDayRes.body.workload[0].capacity, 5);

    // Save OT workload (12h)
    const otRes = await callApi(handler, {
      action: 'saveWorkload',
      token: 'valid-jwt',
      date: '2026-08-26',
      workload: {
        capacity: 12,
        outbound: 8,
        inbound: 4,
        transfer: 0,
        shared: 0,
        primaryCore: 'ขาออก',
        supportDuties: [{ name: 'รับสินค้าเข้า', hours: 3 }, { name: 'ช่วยยกสินค้า', hours: 1 }]
      }
    });
    assert.equal(otRes.status, 200);
    assert.equal(otRes.body.workload[0].capacity, 12);
    console.log('  -> Workload Capacity Flex verified.');
  }

  // Test 5: Negative Invariants
  console.log('[5/5] Testing Invariants & Authorization Negatives...');
  {
    const fixtures = {
      now,
      verifyMainJwt: async () => null // Invalid token
    };
    const { handler } = loadEdgeHandler(fixtures);

    const neg1 = await callApi(handler, { action: 'saveShiftRoster', token: 'bad-token' });
    assert.equal(neg1.status, 401);

    const neg2 = await callApi(handler, { action: 'saveAuditRecord', token: 'bad-token' });
    assert.equal(neg2.status, 401);

    const neg3 = await callApi(handler, { action: 'getAuditData', token: 'bad-token' });
    assert.equal(neg3.status, 401);
    console.log('  -> Negative Invariants verified.');
  }

  console.log('=============================================================');
  console.log('🎉 ALL PHASE 2 EDGE & BUSINESS LOGIC TESTS PASSED 100%! 🎉');
  console.log('=============================================================');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
