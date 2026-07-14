const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backend = fs.readFileSync(path.join(__dirname, '../Code.gs.txt'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(content, name) {
    const start = content.indexOf(`function ${name}`);
    if (start === -1) throw new Error(`Function ${name} not found`);
    const openBrace = content.indexOf('{', start);
    let depth = 1;
    let cursor = openBrace + 1;
    while (depth > 0 && cursor < content.length) {
        if (content[cursor] === '{') depth++;
        else if (content[cursor] === '}') depth--;
        cursor++;
    }
    return content.slice(start, cursor);
}

eval(extractFunction(backend, 'getAkraErrorCaseId'));
eval(extractFunction(backend, 'mergeAkraErrorEntries'));
eval(extractFunction(backend, 'parseDailyErrorsText'));
eval(extractFunction(backend, 'mergeDailyErrorSection'));

function trdCaseNote(caseId, note) {
    const marker = `[TRD_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId }))}]`;
    return `${note} ${marker}`;
}

function error(emp, type, caseId, note) {
    return { emp, type, caseId, note: trdCaseNote(caseId, note) };
}

console.log('=== Running TRD Error Persistence Round Trip Tests ===');

{
    const original = [
        '2026-07-14', '', 11, 12, 13, 14, 15, 'customer note',
        'weekly task', '[{"employee":"ท็อป"}]', '{"summary":"done"}'
    ];
    const firstSave = mergeDailyErrorSection(original, [
        error('ท็อป', 'จัดบิลผิด', 'TRD-CASE-1', 'เคสแรก')
    ], 'TRD');
    const secondSave = mergeDailyErrorSection(firstSave, [
        error('ท็อป', 'บริการไม่สุภาพ', 'TRD-CASE-2', 'เคสสอง')
    ], 'TRD');

    const persisted = parseDailyErrorsText(secondSave[1], 'TRD');
    assert.deepStrictEqual(persisted.map(item => item.caseId), ['TRD-CASE-1', 'TRD-CASE-2'],
        'two separate TRD saves on the same date must retain both raw incidents');
    original.forEach((value, index) => {
        if (index !== 1) assert.strictEqual(secondSave[index], value, `Errors save must preserve column ${index + 1}`);
    });
}

{
    const original = ['2026-07-14', '', 1, 2, 3, 4, 5, 'note', 'task', 'workload', 'brief'];
    const firstSave = mergeDailyErrorSection(original, [
        error('ท็อป', 'จัดบิลผิด', 'TRD-SHARED-1', 'เดิม'),
        error('มะปราง', 'จัดบิลผิด', 'TRD-SHARED-1', 'เดิม')
    ], 'TRD');
    const retrySave = mergeDailyErrorSection(firstSave, [
        error('ท็อป', 'จัดบิลผิด', 'TRD-SHARED-1', 'แก้หมายเหตุ'),
        error('มะปราง', 'จัดบิลผิด', 'TRD-SHARED-1', 'แก้หมายเหตุ')
    ], 'TRD');
    const distinctSave = mergeDailyErrorSection(retrySave, [
        error('ท็อป', 'บริการไม่สุภาพ', 'TRD-CASE-2', 'อีกเคส')
    ], 'TRD');

    const persisted = parseDailyErrorsText(distinctSave[1], 'TRD');
    assert.deepStrictEqual(persisted.map(item => `${item.caseId}:${item.emp}`), [
        'TRD-SHARED-1:ท็อป', 'TRD-SHARED-1:มะปราง', 'TRD-CASE-2:ท็อป'
    ], 'retry must update by stable case+employee while multi-employee and distinct cases remain independent');
    assert.ok(persisted[0].note.includes('แก้หมายเหตุ'));
    assert.ok(persisted[1].note.includes('แก้หมายเหตุ'));
}

const TRD_CASE_MARKER = '[TRD_CASE:';
eval(extractFunction(html, 'parseTrdCaseNote'));
const HP_PENALTY = { 'จัดบิลผิด': 5, 'บริการไม่สุภาพ': 20 };
function parseAkraCaseNote(note) { return { meta: null, note }; }
function getAkraCatalogItem() { return null; }
eval(extractFunction(html, 'getLegacyPenaltyDetail'));
eval(extractFunction(html, 'getErrorDetail'));
eval(extractFunction(html, 'accumulateDailyEmployeePenalty'));
eval(extractFunction(html, 'isNoErrorsConfirmation'));
eval(extractFunction(html, 'getRealErrorEntries'));
eval(extractFunction(html, 'stripErrorNoteForExport'));
function normalizeEndOfShiftBrief() {
    return { issues: '', followUps: '', vendorBills: { totalToday: '', entryStatus: '' } };
}
function hasEndOfShiftContent() { return false; }
eval(extractFunction(html, 'aggregateDescriptivePeriod'));

{
    const note = trdCaseNote('TRD-CUSTOM-1', '[หัก 15 HP] รายละเอียด');
    const detail = getErrorDetail({ emp: 'ท็อป', type: 'ความผิดอื่น ๆ', note }, 'TRD');
    assert.strictEqual(detail.penalty, 15, 'TRD metadata must not break custom HP parsing');
    assert.strictEqual(detail.cleanNote, 'รายละเอียด', 'TRD metadata must stay hidden from displayed evidence');
    assert.strictEqual(detail.caseId, 'TRD-CUSTOM-1');
}

{
    const meta = { v: 1, caseId: 'NO_ERRORS', type: 'ไม่มีความผิดพลาด', penalty: 0 };
    const confirmation = {
        emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', caseId: 'NO_ERRORS',
        note: `ยืนยันไม่มีความผิดพลาดในวันนี้ [TRD_CASE:${encodeURIComponent(JSON.stringify(meta))}]`
    };

    const detail = getErrorDetail(confirmation, 'TRD');
    assert.strictEqual(detail.penalty, 0, 'TRD confirmed-zero must never deduct legacy fallback HP');
    assert.deepStrictEqual(getRealErrorEntries([confirmation], 'TRD'), [],
        'TRD confirmed-zero must not count as a raw real error or evidence event');
    assert.doesNotMatch(stripErrorNoteForExport(confirmation.note, 'TRD'), /TRD_CASE|AKRA_CASE/,
        'TRD case metadata must not leak into exported notes');

    const real = error('ท็อป', 'จัดบิลผิด', 'TRD-REAL-1', 'real note');
    const realThenConfirmation = mergeDailyErrorSection(
        ['2026-07-14', real.emp + ' | ' + real.type + ' | ' + real.note], [confirmation], 'TRD'
    );
    assert.deepStrictEqual(parseDailyErrorsText(realThenConfirmation[1], 'TRD').map(item => item.caseId), ['TRD-REAL-1'],
        'NO_ERRORS must not replace or coexist with an existing real TRD incident');
    const confirmationThenReal = mergeDailyErrorSection(
        ['2026-07-14', confirmation.emp + ' | ' + confirmation.type + ' | ' + confirmation.note], [real], 'TRD'
    );
    assert.deepStrictEqual(parseDailyErrorsText(confirmationThenReal[1], 'TRD').map(item => item.caseId), ['TRD-REAL-1'],
        'a real TRD incident must replace an earlier NO_ERRORS confirmation');
}

{
    const copied = `[TRD_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId: 'COPIED' }))}]`;
    const generated = `[TRD_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId: 'GENERATED' }))}]`;
    const note = `ข้อความผู้ใช้ ${copied} ต้องเก็บไว้ ${generated}`;
    const parsed = parseTrdCaseNote(note);
    assert.strictEqual(parsed.meta.caseId, 'GENERATED',
        'only the valid generated terminal marker may define TRD case identity');
    assert.strictEqual(getAkraErrorCaseId({ type: 'จัดบิลผิด', note }, 'TRD'), 'GENERATED',
        'backend retry identity must use the same terminal-marker rule as the frontend');
    assert.ok(parsed.note.includes(copied), 'copied marker-like user text must remain ordinary note content');
    assert.ok(!parsed.note.includes(generated), 'the generated identity marker must not leak into displayed evidence');

    const invalidTerminal = `ข้อความ ${copied} [TRD_CASE:${encodeURIComponent(JSON.stringify({ v: 2, caseId: 'INVALID' }))}]`;
    assert.strictEqual(parseTrdCaseNote(invalidTerminal).meta, null,
        'a terminal marker with an unsupported version must not become identity');
    assert.strictEqual(getAkraErrorCaseId({ type: 'จัดบิลผิด', note: invalidTerminal }, 'TRD'), '',
        'backend must not fall back to copied marker text when the terminal marker is invalid');

    const copiedAkra = `[AKRA_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId: 'COPIED-AKRA' }))}]`;
    const mixedNote = `${copiedAkra} ข้อความผู้ใช้ ${generated}`;
    assert.strictEqual(getAkraErrorCaseId({ type: 'จัดบิลผิด', note: mixedNote }, 'TRD'), 'GENERATED',
        'backend must prefer the valid terminal TRD marker over copied AKRA marker text');
    const generatedAkra = `[AKRA_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId: 'GENERATED-AKRA' }))}]`;
    const copiedTrd = `[TRD_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId: 'COPIED-TRD' }))}]`;
    const akraMixedNote = `${generatedAkra} ข้อความผู้ใช้ ${copiedTrd}`;
    assert.strictEqual(getAkraErrorCaseId({ type: 'หยิบผิด', note: akraMixedNote }, 'AKRA'), 'GENERATED-AKRA',
        'AKRA backend identity must use the generated leading AKRA marker, not copied terminal TRD text');
    assert.strictEqual(getAkraErrorCaseId({ type: 'หยิบผิด', note: copiedAkra }, 'AKRA'), 'COPIED-AKRA',
        'AKRA-only persisted marker behavior must remain compatible');
}

{
    const legacy = ['2026-07-14', 'ท็อป | จัดบิลผิด | legacy note', 1, 2, 3, 4, 5, 'note', 'task', 'workload', 'brief'];
    const merged = mergeDailyErrorSection(legacy, [
        error('ท็อป', 'บริการไม่สุภาพ', 'TRD-NEW-1', 'new note')
    ], 'TRD');
    const persisted = parseDailyErrorsText(merged[1], 'TRD');
    assert.strictEqual(persisted.length, 2, 'legacy rows without case metadata must remain readable and must not be removed');
    assert.strictEqual(persisted[0].caseId, '');

    const penalties = {};
    const loss = persisted.reduce((sum, item) => {
        const detail = getErrorDetail(item, 'TRD');
        return sum + accumulateDailyEmployeePenalty(penalties, item.emp, '2026-07-14', 'TRD', detail);
    }, 0);
    assert.strictEqual(loss, 20,
        'persisted same-date TRD incidents must still deduct only the highest employee penalty');
}

{
    const trdConfirmation = {
        emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด',
        note: `ยืนยันไม่มีความผิดพลาด [TRD_CASE:${encodeURIComponent(JSON.stringify({ v: 1, caseId: 'NO_ERRORS' }))}]`
    };
    const akraConfirmation = { emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', note: '' };
    const rows = [
        { date: '2026-07-14', sourceBranch: 'TRD', volume: { transfer: 100 }, errors: [trdConfirmation, { emp: 'ท็อป', type: 'จัดบิลผิด', note: 'real' }] },
        { date: '2026-07-14', sourceBranch: 'AKRA', volume: { transfer: 100 }, errors: [akraConfirmation, { emp: 'เอส', type: 'หยิบผิด', note: 'real' }] }
    ];
    const trdMetrics = aggregateDescriptivePeriod(rows, 'TRD', 1);
    assert.strictEqual(trdMetrics.errors, 1, 'TRD executive totals must exclude confirmed-zero rows');
    assert.strictEqual(trdMetrics.errorRate, 0.01, 'TRD executive error rate must use only real incidents');
    const allMetrics = aggregateDescriptivePeriod(rows, 'ALL', 1);
    assert.strictEqual(allMetrics.errors, 2, 'cross-branch executive totals must exclude both branches\' confirmations');
    assert.strictEqual(allMetrics.errorRate, 0.01, 'cross-branch executive rate must use real incidents and combined volume');
}

const initAppSource = extractFunction(html, 'initApp');
const saveErrorsSource = extractFunction(html, 'saveErrorsCard');
let currentBranch = 'TRD';
eval(extractFunction(html, 'prepareTrdErrorEntriesForNextSave'));

{
    const entries = [
        { dataset: { caseId: 'TRD-SAVED-1' } },
        { dataset: { caseId: 'TRD-SAVED-2' } }
    ];
    const originalDocument = global.document;
    const originalNow = Date.now;
    const originalRandom = Math.random;
    global.document = {
        querySelectorAll(selector) {
            assert.strictEqual(selector, '.error-entry');
            return entries;
        }
    };
    Date.now = () => 1720951200000;
    let randomIndex = 0;
    const randomValues = [0.111, 0.222];
    Math.random = () => randomValues[randomIndex++];

    try {
        prepareTrdErrorEntriesForNextSave('2026-07-14');
        assert.notStrictEqual(entries[0].dataset.caseId, 'TRD-SAVED-1',
            'a confirmed TRD save must prepare the same visible entry as a new incident');
        assert.notStrictEqual(entries[1].dataset.caseId, 'TRD-SAVED-2',
            'every visible TRD entry must receive a fresh identity after confirmed success');
        assert.notStrictEqual(entries[0].dataset.caseId, entries[1].dataset.caseId,
            'separate visible entries must receive separate fresh identities');

        const trdIds = entries.map(entry => entry.dataset.caseId);
        currentBranch = 'AKRA';
        prepareTrdErrorEntriesForNextSave('2026-07-14');
        assert.deepStrictEqual(entries.map(entry => entry.dataset.caseId), trdIds,
            'TRD append-on-save behavior must not change AKRA case identity');
    } finally {
        currentBranch = 'TRD';
        global.document = originalDocument;
        Date.now = originalNow;
        Math.random = originalRandom;
    }
}

assert.match(initAppSource, /btnSave\.classList\.add\('hidden'\)/,
    'legacy full-row save must remain hidden after TRD gets scoped Errors persistence');
assert.match(initAppSource, /btnSaveErrors\.classList\.remove\('hidden'\)/,
    'scoped Errors save must be available to TRD and AKRA');
assert.match(saveErrorsSource, /encodeTrdCaseMeta\(\{ v: 1, caseId: caseId \}\)/,
    'TRD saves must persist the stable UI case ID inside the existing Errors note contract');
assert.match(saveErrorsSource, /branch === 'AKRA'[\s\S]*encodeAkraCaseMeta\(meta\)[\s\S]*encodeTrdCaseMeta\(meta\)/,
    'confirmed-zero notes must use branch-correct metadata');
assert.match(saveErrorsSource, /prepareTrdErrorEntriesForNextSave\(date, entries, branch\)/,
    'confirmed success must rotate TRD case identity before the next intentional save');
for (const consumer of ['loadDashboardData', 'aggregateDescriptivePeriod', 'buildParetoAnalysis', 'renderAdminDashboard', 'exportAdminDataCSV']) {
    assert.match(extractFunction(html, consumer), /getRealErrorEntries\(/,
        `${consumer} must exclude confirmed-zero markers from real error counts and evidence`);
}

console.log('TRD error persistence round-trip checks passed.');
