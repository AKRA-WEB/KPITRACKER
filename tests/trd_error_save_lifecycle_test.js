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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeEntry(caseId) {
    const fields = {
        '.err-type': { value: 'จัดบิลผิด' },
        '.err-note': { value: 'เหตุการณ์เดิมที่กดบันทึกอีกครั้ง' },
        '.err-stage': null
    };
    return {
        dataset: { caseId },
        querySelector(selector) { return fields[selector] || null; },
        querySelectorAll(selector) {
            assert.strictEqual(selector, '.err-emp-cb:checked');
            return [{ value: 'ท็อป' }];
        }
    };
}

console.log('=== Running TRD Error Save Lifecycle Tests ===');

(async () => {
    const dateInput = { value: '2026-07-14', disabled: false };
    const saveButton = { innerHTML: 'บันทึกความผิดพลาด', disabled: false };
    const submittedEntry = makeEntry('TRD-SAVED-1');
    const otherDateEntry = makeEntry('TRD-OTHER-DATE');
    let visibleEntries = [submittedEntry];
    let currentBranch = 'TRD';
    let currentUser = 'tester';
    let guardCalls = 0;
    let postCalls = 0;
    let postedPayload;
    const guard = deferred();
    const post = deferred();
    let postResult = post.promise;

    const document = {
        getElementById(id) {
            if (id === 'record-date') return dateInput;
            if (id === 'btn-save-errors') return saveButton;
            throw new Error(`Unexpected element: ${id}`);
        },
        querySelectorAll(selector) {
            assert.strictEqual(selector, '.error-entry');
            return visibleEntries;
        }
    };
    const AppVersionGuard = {
        blockIfStale() {
            guardCalls++;
            return guard.promise;
        }
    };
    const safeStorage = { removeItem() {} };
    const isAkraSharedType = () => false;
    const encodeTrdCaseMeta = meta => `[TRD_CASE:${meta.caseId}]`;
    const saveRecordDraft = () => {};
    const showToast = () => {};
    const showModal = () => {};
    const sendAppLog = () => {};
    const syncDataFromSheet = async () => {};
    const loadDashboardData = () => {};
    const updateDailyDashboard = () => {};
    const postToAppScript = payload => {
        postCalls++;
        postedPayload = payload;
        return postResult;
    };

    eval(extractFunction(html, 'prepareTrdErrorEntriesForNextSave'));
    eval(extractFunction(html, 'saveErrorsCard').replace('function saveErrorsCard', 'async function saveErrorsCard'));

    const firstSave = saveErrorsCard();
    const duplicateClick = saveErrorsCard();

    assert.strictEqual(saveButton.disabled, true,
        'the Errors save button must lock before the asynchronous version check');
    assert.strictEqual(dateInput.disabled, true,
        'the submitted date must stay locked until the save lifecycle finishes');
    assert.strictEqual(guardCalls, 1,
        'a rapid second click must be ignored instead of starting another version check');

    visibleEntries = [otherDateEntry];
    dateInput.value = '2026-07-15';
    currentBranch = 'AKRA';
    guard.resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(postCalls, 1, 'a rapid second click must produce only one POST');
    assert.strictEqual(postedPayload.date, '2026-07-14');
    assert.strictEqual(postedPayload.branch, 'TRD');
    assert.strictEqual(postedPayload.errors[0].caseId, 'TRD-SAVED-1',
        'the submitted ID must stay stable until the server confirms success');

    post.resolve({ status: 'success' });
    await Promise.all([firstSave, duplicateClick]);

    assert.notStrictEqual(submittedEntry.dataset.caseId, 'TRD-SAVED-1',
        'success must rotate the identity of the entries that were actually submitted');
    assert.strictEqual(otherDateEntry.dataset.caseId, 'TRD-OTHER-DATE',
        'success must not rotate entries from a different form/date rendered in the meantime');
    assert.strictEqual(submittedEntry.querySelector('.err-note').value, 'เหตุการณ์เดิมที่กดบันทึกอีกครั้ง',
        'preparing the next incident must preserve visible form values');
    assert.strictEqual(saveButton.disabled, false, 'the save button must unlock after completion');
    assert.strictEqual(dateInput.disabled, false, 'the date control must restore its prior state');

    currentBranch = 'TRD';
    visibleEntries = [submittedEntry];
    dateInput.value = '2026-07-14';
    const confirmedId = submittedEntry.dataset.caseId;
    postResult = Promise.resolve({ status: 'error', message: 'server rejected save' });
    await saveErrorsCard();
    assert.strictEqual(submittedEntry.dataset.caseId, confirmedId,
        'an unconfirmed or rejected save must retain its case ID for an idempotent retry');

    console.log('TRD error save lifecycle checks passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
