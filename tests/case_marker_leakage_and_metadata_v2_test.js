const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('=== RUNNING CASE MARKER LEAKAGE & METADATA V2 PARSING TEST ===\n');

const htmlPath = path.resolve(__dirname, '../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// 1. Verify inline scripts compile with node:vm
console.log('[1/4] Compiling all inline <script> blocks in index.html...');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 0;
while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const code = match[1];
    if (!code.trim()) continue;
    scriptIndex++;
    new vm.Script(code, { filename: `inline-script-${scriptIndex}.js` });
}
assert(scriptIndex >= 1, 'Must find at least 1 script block in index.html');
console.log(`  -> Passed: ${scriptIndex} script blocks compiled with zero syntax errors.`);

// 2. Extract and test metadata parsing functions directly in sandbox
console.log('\n[2/4] Testing parseAkraCaseNote & parseTrdCaseNote with v1 and v2 metadata...');

function extractFunction(source, fnName) {
    const match = source.match(new RegExp(`function\\s+${fnName}\\s*\\([\\s\\S]*?\\n\\s{8}\\}`, 'm'));
    if (!match) throw new Error(`Function ${fnName} not found in index.html`);
    return match[0];
}

const sandbox = {
    AKRA_CASE_MARKER: '[AKRA_CASE:',
    TRD_CASE_MARKER: '[TRD_CASE:',
    HP_PENALTY: { 'จัดบิลผิด': 5, 'บริการไม่สุภาพ': 20, 'หยิบผิด': 10 },
    getAkraCatalogItem: (type) => ({ type, penalty: 10, core: 'outbound', coreLabel: 'ขาออก & จัดส่ง' }),
    parseAkraCaseNote: null,
    parseTrdCaseNote: null,
    encodeAkraCaseMeta: null,
    encodeTrdCaseMeta: null,
    getLegacyPenaltyDetail: null,
    getErrorDetail: null,
    stripErrorNoteForExport: null,
    isNoErrorsConfirmation: null,
    getRealErrorEntries: null
};

vm.createContext(sandbox);
vm.runInContext(`
${extractFunction(htmlContent, 'encodeAkraCaseMeta')}
${extractFunction(htmlContent, 'parseAkraCaseNote')}
${extractFunction(htmlContent, 'encodeTrdCaseMeta')}
${extractFunction(htmlContent, 'parseTrdCaseNote')}
${extractFunction(htmlContent, 'getLegacyPenaltyDetail')}
${extractFunction(htmlContent, 'getErrorDetail')}
${extractFunction(htmlContent, 'stripErrorNoteForExport')}
${extractFunction(htmlContent, 'isNoErrorsConfirmation')}
${extractFunction(htmlContent, 'getRealErrorEntries')}
`, sandbox);

// Test AKRA v1 and v2
const akraV1Meta = { v: 1, caseId: 'ERR-AKRA-V1', type: 'หยิบผิด', penalty: 10, core: 'outbound', coreLabel: 'ขาออก & จัดส่ง' };
const akraV1Note = `${sandbox.encodeAkraCaseMeta(akraV1Meta)} สินค้าเกิน 1 ลัง`;
const parsedAkraV1 = sandbox.parseAkraCaseNote(akraV1Note);
assert.strictEqual(parsedAkraV1.meta.caseId, 'ERR-AKRA-V1');
assert.strictEqual(parsedAkraV1.note, 'สินค้าเกิน 1 ลัง');

const akraV2Meta = { v: 2, caseId: 'ERR-AKRA-V2', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 5, category: 'outbound', stage: 'warehouse', responsibility: 'individual' };
const akraV2Note = `${sandbox.encodeAkraCaseMeta(akraV2Meta)} แก้ไขทันเวลารถออก`;
const parsedAkraV2 = sandbox.parseAkraCaseNote(akraV2Note);
assert.strictEqual(parsedAkraV2.meta.caseId, 'ERR-AKRA-V2');
assert.strictEqual(parsedAkraV2.note, 'แก้ไขทันเวลารถออก');

const detailAkraV2 = sandbox.getErrorDetail({ emp: 'สมชาย', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', note: akraV2Note }, 'AKRA');
assert.strictEqual(detailAkraV2.isAkraCase, true, 'AKRA v2 case must be recognized as isAkraCase');
assert.strictEqual(detailAkraV2.penalty, 5, 'AKRA v2 penalty must be 5 HP');
assert.strictEqual(detailAkraV2.cleanNote, 'แก้ไขทันเวลารถออก', 'cleanNote must be clean and NOT leak AKRA_CASE marker');
assert.ok(!detailAkraV2.cleanNote.includes('AKRA_CASE'), 'Zero AKRA_CASE marker in cleanNote');

// Test TRD v1 and v2
const trdV1Meta = { v: 1, caseId: 'ERR-TRD-V1' };
const trdV1Note = `ลูกค้าแจ้งยอดไม่ตรง [TRD_CASE:${encodeURIComponent(JSON.stringify(trdV1Meta))}]`;
const parsedTrdV1 = sandbox.parseTrdCaseNote(trdV1Note);
assert.strictEqual(parsedTrdV1.meta.caseId, 'ERR-TRD-V1');
assert.strictEqual(parsedTrdV1.note, 'ลูกค้าแจ้งยอดไม่ตรง');

const trdV2Meta = { v: 2, caseId: 'ERR-TRD-V2', penalty: 15, type: 'จัดบิลผิด' };
const trdV2Note = `บิลผิด 2 ใบ [TRD_CASE:${encodeURIComponent(JSON.stringify(trdV2Meta))}]`;
const parsedTrdV2 = sandbox.parseTrdCaseNote(trdV2Note);
assert.strictEqual(parsedTrdV2.meta.caseId, 'ERR-TRD-V2');
assert.strictEqual(parsedTrdV2.note, 'บิลผิด 2 ใบ');

const detailTrdV2 = sandbox.getErrorDetail({ emp: 'ท็อป', type: 'จัดบิลผิด', note: trdV2Note }, 'TRD');
assert.strictEqual(detailTrdV2.penalty, 15, 'TRD v2 penalty must be preserved');
assert.strictEqual(detailTrdV2.cleanNote, 'บิลผิด 2 ใบ', 'cleanNote must be clean and NOT leak TRD_CASE marker');
assert.ok(!detailTrdV2.cleanNote.includes('TRD_CASE'), 'Zero TRD_CASE marker in cleanNote');

console.log('  -> Passed: Both v1 and v2 metadata parse cleanly with 0 marker leak.');

// 3. Defense-in-depth marker stripping in getLegacyPenaltyDetail
console.log('\n[3/4] Testing defense-in-depth marker stripping in legacy fallback...');
const legacyUnparsedNote = '[AKRA_CASE:something_corrupted] ข้อความเหตุการณ์ [TRD_CASE:dummy]';
const legacyDetail = sandbox.getLegacyPenaltyDetail({ type: 'ความผิดอื่น ๆ', note: legacyUnparsedNote });
assert.strictEqual(legacyDetail.cleanNote, 'ข้อความเหตุการณ์', 'Lingering markers must be completely stripped');
assert.ok(!legacyDetail.cleanNote.includes('AKRA_CASE'));
assert.ok(!legacyDetail.cleanNote.includes('TRD_CASE'));
console.log('  -> Passed: Defense-in-depth sanitization strips all stray markers.');

// 4. Version Parity Check
console.log('\n[4/4] Checking version parity between index.html and version.json...');
const versionJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../version.json'), 'utf8'));
assert(versionJson.version, 'version.json must have a version string');
assert(htmlContent.includes(`const CURRENT_VERSION = "${versionJson.version}";`));
assert(htmlContent.includes(`id="drawer-version-text">KPI Suite v${versionJson.version}</span>`));
assert(htmlContent.includes(`supabase-kpi-client.js?v=${versionJson.version}`));
console.log(`  -> Passed: Version parity verified at ${versionJson.version}.`);

console.log('\n=======================================================');
console.log('🎉 ALL CASE MARKER & METADATA V2 PARSING CHECKS PASSED! 🎉');
console.log('=======================================================\n');
