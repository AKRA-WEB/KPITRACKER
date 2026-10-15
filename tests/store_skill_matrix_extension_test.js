const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extension = require('../js/store-skill-matrix-extension.js');

assert.strictEqual(extension.BLUEPRINT_VERSION, '20260827.01');
assert.strictEqual(extension.LEVEL_LABELS[0], 'Lv.0 ยังไม่ได้ฝึก/ยังไม่ได้รับรอง');
assert.strictEqual(extension.LEVEL_LABELS[2], 'Lv.2 ทำเองได้ตามมาตรฐาน');
assert.strictEqual(extension.LEVEL_LABELS[3], 'Lv.3 ชำนาญ / ตรวจงานและสอนคนอื่นได้');

const departmentIds = extension.DEPARTMENTS.map(dept => dept.id);
assert.deepStrictEqual(departmentIds, ['w1_front', 'outbound', 'inbound', 'transfer', 'w1_warehouse']);

const skillCodes = new Set(extension.SKILLS.map(skill => skill.code));
for (const requiredCode of [
  'FND_PRODUCT', 'FND_BILL_READ', 'FND_COUNT', 'FND_FEFO', 'FND_HANDLING',
  'W1_POS', 'W1_CHECKER', 'OUT_PICK', 'OUT_VERIFY', 'IN_RECEIVE_QC', 'IN_SYSTEM',
  'TR_PICK', 'TR_HANDOVER', 'WH1_STOCK_COUNT', 'WH1_REPLENISH_REQ'
]) {
  assert(skillCodes.has(requiredCode), `missing required store skill ${requiredCode}`);
}

// A new employee with no certifications is not trained for every role.
const noSkill = extension.calculateRoleReadiness([], 'EMP001', 'พนักงานทดสอบ', 'outbound_operator');
assert.strictEqual(noSkill.status, 'not_trained');
assert.strictEqual(noSkill.met, 0);
assert(noSkill.gaps.length > 0);

// Partial certification should show Training rather than Qualified.
const partial = extension.calculateRoleReadiness([
  { employeeUid: 'EMP001', employeeName: 'พนักงานทดสอบ', skillCode: 'FND_PRODUCT', level: 2 },
  { employeeUid: 'EMP001', employeeName: 'พนักงานทดสอบ', skillCode: 'FND_BILL_READ', level: 2 },
  { employeeUid: 'EMP001', employeeName: 'พนักงานทดสอบ', skillCode: 'OUT_PICK', level: 1 }
], 'EMP001', 'พนักงานทดสอบ', 'outbound_operator');
assert.strictEqual(partial.status, 'training');
assert(partial.coveragePct > 0 && partial.coveragePct < 100);
assert(partial.gaps.some(gap => gap.skillCode === 'OUT_PICK' && gap.currentLevel === 1 && gap.requiredLevel === 2));

// Complete required levels should produce Qualified.
const outboundRole = extension.DEPARTMENTS.find(dept => dept.id === 'outbound').roles[0];
const qualifiedCerts = Object.entries(outboundRole.requirements).map(([skillCode, level]) => ({
  employeeUid: 'EMP002', employeeName: 'Qualified User', skillCode, level
}));
const qualified = extension.calculateRoleReadiness(qualifiedCerts, 'EMP002', 'Qualified User', 'outbound_operator');
assert.strictEqual(qualified.status, 'qualified');
assert.strictEqual(qualified.coveragePct, 100);
assert.strictEqual(qualified.gaps.length, 0);

// Checker has deliberately stricter foundation requirements than a normal storefront operator.
const checker = extension.calculateRoleReadiness([], 'EMP003', 'Checker Candidate', 'w1_checker');
const checkerProduct = checker.entries.find(item => item.skillCode === 'FND_PRODUCT');
const checkerBill = checker.entries.find(item => item.skillCode === 'FND_BILL_READ');
assert.strictEqual(checkerProduct.requiredLevel, 3);
assert.strictEqual(checkerBill.requiredLevel, 3);

// Persisted payload remains compatible with the existing catalog API: no new table/schema is required.
const samplePayload = extension.getPersistableSkill(extension.SKILLS[0]);
assert.deepStrictEqual(Object.keys(samplePayload).sort(), ['category', 'code', 'description', 'icon', 'isActive', 'levels', 'name'].sort());
assert.strictEqual(samplePayload.levels.length, 3);
assert.strictEqual(samplePayload.isActive, true);

// Loader is additive: it is wired through the existing Supabase client and does not require rewriting index.html.
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-kpi-client.js'), 'utf8');
assert(clientSource.includes('store-skill-matrix-extension.js?v=20260827.01'));
assert(clientSource.includes("root.addEventListener('load', load, { once: true })"));

console.log('store skill matrix extension tests passed');
