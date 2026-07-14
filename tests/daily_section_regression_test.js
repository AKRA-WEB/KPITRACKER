const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '../Code.gs.txt'), 'utf8');
const AKRA_CASE_MARKER = '[AKRA_CASE:';

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

eval(extractFunction(html, 'normalizeEmpName'));
eval(extractFunction(html, 'parseAkraCaseNote'));
eval(extractFunction(html, 'getAuthoritativeRoster'));
eval(extractFunction(html, 'getDailyWorkloadState'));

let activeNames = new Set();
function isEmployeeActive(name) {
    return activeNames.has(normalizeEmpName(name));
}

function caseNote(caseId, updatedAt, onDuty) {
    const meta = { caseId, updatedAt };
    if (onDuty) meta.onDuty = onDuty;
    return `[AKRA_CASE:${encodeURIComponent(JSON.stringify(meta))}] note`;
}

function error(emp, type, caseId, updatedAt) {
    return { emp, type, caseId, note: caseNote(caseId, updatedAt) };
}

console.log('=== Running Daily Section Regression Tests ===');

{
    const existing = [error('A', 'หยิบผิด', 'CASE-1', '2026-07-14T08:00:00.000Z')];
    const incoming = [error('system', 'ไม่มีความผิดพลาด', 'NO_ERRORS', '2026-07-14T09:00:00.000Z')];
    const merged = mergeAkraErrorEntries(existing, incoming);
    assert.deepStrictEqual(merged.map(getAkraErrorCaseId), ['CASE-1'],
        'NO_ERRORS must never delete or coexist with an existing real error');
}

{
    const existing = [error('system', 'ไม่มีความผิดพลาด', 'NO_ERRORS', '2026-07-14T08:00:00.000Z')];
    const incoming = [error('A', 'หยิบผิด', 'CASE-2', '2026-07-14T09:00:00.000Z')];
    const merged = mergeAkraErrorEntries(existing, incoming);
    assert.deepStrictEqual(merged.map(getAkraErrorCaseId), ['CASE-2'],
        'A real error must replace a stale NO_ERRORS marker without losing the real case');
}

{
    const oldRoster = error('system', 'ไม่มีความผิดพลาด', 'ROSTER-OLD', '2026-07-14T10:00:00.000Z');
    oldRoster.note = caseNote('ROSTER-OLD', '2026-07-14T10:00:00.000Z', ['A', 'C']);
    const retriedEarlierArrayEntry = error('system', 'ไม่มีความผิดพลาด', 'ROSTER-RETRY', '2026-07-14T12:00:00.000Z');
    retriedEarlierArrayEntry.note = caseNote('ROSTER-RETRY', '2026-07-14T12:00:00.000Z', ['A', 'B']);
    assert.deepStrictEqual(getAuthoritativeRoster({ errors: [retriedEarlierArrayEntry, oldRoster] }), ['A', 'B'],
        'Roster selection must use latest updatedAt even when a retry updates an earlier array slot');
}

{
    activeNames = new Set(['A', 'B', 'C']);
    const state = getDailyWorkloadState([
        { employee: 'A', outbound: 1, updatedAt: '2026-07-14T09:00:00.000Z' },
        { employee: 'C', outbound: 1, updatedAt: '2026-07-14T10:00:00.000Z' }
    ], ['A', 'B']);
    assert.strictEqual(state.recordedCount, 1);
    assert.strictEqual(state.expectedCount, 2);
    assert.strictEqual(state.isComplete, false, 'A/C records must not satisfy an A/B roster');
    assert.deepStrictEqual(state.workload.map(item => normalizeEmpName(item.employee)), ['A'],
        'Dashboard details must exclude active employees outside the authoritative roster');
}

{
    activeNames = new Set(['หมูหยอง', 'B']);
    const state = getDailyWorkloadState([
        { employee: 'หยอง', outbound: 1, updatedAt: '2026-07-14T08:00:00.000Z' },
        { employee: 'หมูหยอง', outbound: 2, updatedAt: '2026-07-14T09:00:00.000Z' },
        { employee: 'Inactive', outbound: 8, updatedAt: '2026-07-14T11:00:00.000Z' }
    ], ['หยอง', 'หมูหยอง', 'B', 'Inactive']);
    assert.strictEqual(state.recordedCount, 1, 'Normalized duplicates and inactive rows must not inflate completion');
    assert.strictEqual(state.expectedCount, 2);
    assert.strictEqual(state.isComplete, false);
    assert.strictEqual(state.workload.length, 1);
    assert.strictEqual(state.workload[0].outbound, 2, 'Latest normalized duplicate should drive details and latest update');
}

console.log('Daily section regression checks passed.');
