const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const client = require('../js/supabase-kpi-client.js');

const mockJwtSecret = '0000000000000000000000000000000000000000000000000000000000000000';

function makeToken(username, name, roles = ['admin']) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: username,
    username,
    name,
    roles,
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', Buffer.from(mockJwtSecret, 'hex'))
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

(async () => {
  console.log('=== RUNNING PHASE 3 SKILL MATRIX & PROFILE TESTS ===\n');

  const adminToken = makeToken('AKRA12123', 'หมูหยอง', ['admin', 'supervisor']);
  const staffToken = makeToken('AKRA12124', 'เอี้ยง', ['user']);

  // Mock global fetch for local contract verification
  const skillCatalog = [
    { code: 'FORKLIFT', name: 'ขับรถยก / โฟล์คลิฟต์', category: 'warehouse', icon: 'fa-truck-ramp-box', description: 'ขับขี่และควบคุมรถยกไฟฟ้า/โฟล์คลิฟต์', levels: ['ระดับ 1: พื้นฐาน', 'ระดับ 2: ชำนาญ', 'ระดับ 3: ครูฝึก'] },
    { code: 'PICK_W1', name: 'จัดและแพ็กสินค้า W1', category: 'warehouse', icon: 'fa-boxes-packing', description: 'หยิบและตรวจนับสินค้าในคลัง W1', levels: ['ระดับ 1: พื้นฐาน', 'ระดับ 2: ชำนาญ', 'ระดับ 3: ครูฝึก'] },
    { code: 'STORE_W2', name: 'จัดเก็บและโอนย้าย W2', category: 'warehouse', icon: 'fa-cubes-stacked', description: 'บริหารจัดการสต็อก คลังสำรอง W2', levels: ['ระดับ 1: พื้นฐาน', 'ระดับ 2: ชำนาญ', 'ระดับ 3: ครูฝึก'] },
    { code: 'POS_CASHIER', name: 'ระบบแคชเชียร์ & บิลขาย', category: 'storefront', icon: 'fa-cash-register', description: 'เปิดบิลขาย คิดเงิน ทอนเงิน', levels: ['ระดับ 1: พื้นฐาน', 'ระดับ 2: ชำนาญ', 'ระดับ 3: ครูฝึก'] }
  ];

  const employeeSkillsDb = new Map();

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body || '{}');
    const token = body.token || '';

    if (!token || token.includes('invalid')) {
      return {
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'error', reason: 'jwt_invalid' })
      };
    }

    if (body.action === 'getSkillCatalog') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success', skills: skillCatalog })
      };
    }

    if (body.action === 'getEmployeeSkills') {
      const list = Array.from(employeeSkillsDb.values()).filter(s => !body.employeeUid || s.employeeUid === body.employeeUid);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success', skills: list })
      };
    }

    if (body.action === 'saveEmployeeSkill') {
      if (body.level < 1 || body.level > 3) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'error', reason: 'invalid_level' })
        };
      }
      const key = `${body.employeeUid}:${body.skillCode}`;
      const entry = {
        id: `skill-${Date.now()}`,
        employeeUid: body.employeeUid,
        employeeName: body.employeeName,
        skillCode: body.skillCode,
        level: body.level,
        certifiedBy: 'หมูหยอง',
        certifiedAt: new Date().toISOString().slice(0, 10),
        notes: body.notes || ''
      };
      employeeSkillsDb.set(key, entry);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success', skills: Array.from(employeeSkillsDb.values()) })
      };
    }

    if (body.action === 'getEmployeeProfileSummary') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          status: 'success',
          profile: {
            uid: body.employeeUid || 'AKRA12123',
            name: 'หมูหยอง',
            roles: ['admin', 'supervisor'],
            status: 'Active',
            skills: Array.from(employeeSkillsDb.values()),
            qualityHp: 95,
            incidentCount: 1,
            workloadStats: {
              recordedDays: 20,
              totalHours: 200,
              outboundHours: 120,
              inboundHours: 40,
              transferHours: 20,
              sharedHours: 20,
              flexibilityIndex: 10
            }
          }
        })
      };
    }

    return {
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'error', reason: 'unknown_action' })
    };
  };

  console.log('[1/4] Testing getSkillCatalog Client Wrapper...');
  const catalogRes = await client.getSkillCatalog(adminToken);
  assert(Array.isArray(catalogRes.skills), 'skills must be an array');
  assert.equal(catalogRes.skills.length, 4);
  console.log('  -> getSkillCatalog verified successfully.');

  console.log('[2/4] Testing saveEmployeeSkill & getEmployeeSkills...');
  await client.saveEmployeeSkill(adminToken, 'AKRA12123', 'หมูหยอง', 'FORKLIFT', 2, 'ขับรถยกคล่องแคล่ว');
  await client.saveEmployeeSkill(adminToken, 'AKRA12123', 'หมูหยอง', 'PICK_W1', 3, 'ผู้เชี่ยวชาญการหยิบ W1');
  const skillsRes = await client.getEmployeeSkills(staffToken, 'AKRA12123');
  assert.equal(skillsRes.skills.length, 2);
  const forklift = skillsRes.skills.find(s => s.skillCode === 'FORKLIFT');
  assert.equal(forklift.level, 2);
  console.log('  -> saveEmployeeSkill and getEmployeeSkills verified.');

  console.log('[3/4] Testing getEmployeeProfileSummary...');
  const profileRes = await client.getEmployeeProfileSummary(staffToken, 'AKRA12123');
  assert(profileRes.profile, 'profile must exist');
  assert.equal(profileRes.profile.uid, 'AKRA12123');
  assert.equal(profileRes.profile.workloadStats.flexibilityIndex, 10);
  assert.equal(profileRes.profile.qualityHp, 95);
  console.log('  -> getEmployeeProfileSummary verified successfully.');

  console.log('[4/4] Testing Invariants & Authorization Negatives...');
  await assert.rejects(async () => {
    await client.getSkillCatalog('invalid-token');
  }, /jwt_invalid/);

  await assert.rejects(async () => {
    await client.saveEmployeeSkill(adminToken, 'AKRA12123', 'หมูหยอง', 'FORKLIFT', 5, 'Invalid level');
  }, /invalid_level/);
  console.log('  -> Negative Invariants verified.');

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 3 SKILL MATRIX & PROFILE TESTS PASSED 100%! 🎉');
  console.log('=============================================================');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
