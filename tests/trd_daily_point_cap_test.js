const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const HP_PENALTY = {};
eval(extractFunction(html, 'getLegacyPenaltyDetail'));
eval(extractFunction(html, 'normalizeEmpName'));
eval(extractFunction(html, 'accumulateDailyEmployeePenalty'));

function getErrorDetail(error) { return error.detail; }
function getErrorProcess(branch, detail) { return `${branch}:${detail.type}`; }
function getErrorImpact() { return 'ไม่ระบุผลกระทบ'; }
function getRealErrorEntries(errors) { return errors || []; }
eval(extractFunction(html, 'buildParetoAnalysis'));

function dailyLoss(sourceBranch, errors) {
    const penalties = {};
    return errors.reduce((total, error) => total + accumulateDailyEmployeePenalty(
        penalties,
        normalizeEmpName(error.emp),
        error.date,
        sourceBranch,
        error.detail
    ), 0);
}

function rowLoss(sourceBranch, rows) {
    const penalties = {};
    return rows.reduce((total, row) => total + row.errors.reduce((rowTotal, error) => rowTotal +
        accumulateDailyEmployeePenalty(
            penalties,
            normalizeEmpName(error.emp),
            row.date,
            sourceBranch,
            error.detail
        ), 0), 0);
}

console.log('=== Running TRD Daily Point Cap Tests ===');

assert.strictEqual(dailyLoss('TRD', [
    { date: '2026-07-14', emp: 'A', detail: { penalty: 5, isAkraCase: false } },
    { date: '2026-07-14', emp: 'A', detail: { penalty: 10, isAkraCase: false } },
    { date: '2026-07-14', emp: 'A', detail: { penalty: 30, isAkraCase: false } }
]), 30, 'TRD same-day loss must use only the highest penalty');

assert.strictEqual(rowLoss('TRD', [
    { date: '2026-07-14', errors: [{ emp: 'A', detail: { penalty: 30, isAkraCase: false } }] },
    { date: '2026-07-14', errors: [{ emp: 'A', detail: { penalty: 10, isAkraCase: false } }] }
]), 30, 'Duplicate raw rows for the same date must share one employee cap');

assert.strictEqual(dailyLoss('TRD', [
    { date: '2026-07-14', emp: 'A', detail: { penalty: 30, isAkraCase: false } },
    { date: '2026-07-15', emp: 'A', detail: { penalty: 10, isAkraCase: false } }
]), 40, 'TRD losses on different dates must accumulate');

assert.strictEqual(dailyLoss('TRD', [
    { date: '2026-07-14', emp: 'A', detail: { penalty: 5, isAkraCase: false } },
    { date: '2026-07-14', emp: 'A', detail: { penalty: 30, isAkraCase: false } },
    { date: '2026-07-14', emp: 'B', detail: { penalty: 10, isAkraCase: false } },
    { date: '2026-07-14', emp: 'B', detail: { penalty: 5, isAkraCase: false } }
]), 40, 'TRD employees must cap independently on the same date');

assert.strictEqual(dailyLoss('TRD', [
    { date: '2026-07-14', emp: 'หยอง', detail: { penalty: 30, isAkraCase: false } },
    { date: '2026-07-14', emp: 'หมูหยอง', detail: { penalty: 10, isAkraCase: false } }
]), 30, 'Normalized employee aliases must share one daily cap');

const customDetail = getLegacyPenaltyDetail({ type: 'ความผิดอื่น ๆ', note: '[หัก 15 HP] custom issue' });
assert.strictEqual(customDetail.penalty, 15, 'Custom TRD penalty must retain its recorded value');
assert.strictEqual(dailyLoss('TRD', [
    { date: '2026-07-14', emp: 'A', detail: { penalty: 10, isAkraCase: false } },
    { date: '2026-07-14', emp: 'A', detail: customDetail }
]), 15, 'Custom TRD penalty must participate in the daily maximum');

assert.strictEqual(dailyLoss('AKRA', [
    { date: '2026-07-14', emp: 'A', detail: { penalty: 5, isAkraCase: true } },
    { date: '2026-07-14', emp: 'A', detail: { penalty: 20, isAkraCase: true } },
    { date: '2026-07-14', emp: 'A', detail: { penalty: 10, isAkraCase: false } },
    { date: '2026-07-14', emp: 'A', detail: { penalty: 5, isAkraCase: false } }
]), 35, 'AKRA new-format cap and legacy additive scoring must remain unchanged');

const rawIncidents = [
    { emp: 'A', detail: { type: 'Type 1', penalty: 5, cleanNote: 'one' } },
    { emp: 'A', detail: { type: 'Type 1', penalty: 10, cleanNote: 'two' } },
    { emp: 'A', detail: { type: 'Type 2', penalty: 30, cleanNote: 'three' } }
];
const pareto = buildParetoAnalysis([
    { date: '2026-07-14', sourceBranch: 'TRD', errors: rawIncidents }
], 'TRD', 'ALL', 100);
assert.strictEqual(pareto.total, 3, 'Pareto must retain every raw incident despite the HP cap');
assert.deepStrictEqual(pareto.rows.map(row => row.count).sort((a, b) => b - a), [2, 1],
    'Pareto counts must group raw incidents without merging capped penalties');

const dashboardCode = extractFunction(html, 'loadDashboardData');
assert.ok(dashboardCode.includes('accumulateDailyEmployeePenalty'),
    'Weekly Team HP must use the shared daily penalty accumulator');
assert.ok(dashboardCode.indexOf('let dailyEmployeePenalties') < dashboardCode.indexOf('targetWeekData.forEach'),
    'Daily penalty state must span all raw rows in the selected week');
assert.ok(!dashboardCode.includes('akraDailyCaps'),
    'Weekly Team HP must not retain the AKRA-only cap path');

console.log('TRD daily point cap checks passed.');
