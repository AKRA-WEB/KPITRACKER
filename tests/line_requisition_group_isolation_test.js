const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'webhook linesyc.txt');
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    RegExp,
    encodeURIComponent
};
vm.createContext(sandbox);
new vm.Script(source, { filename: sourcePath }).runInContext(sandbox);

const targetGroupId = 'Ca9026f3d07901107f3c1db8ffcd442f2';
const originalHandleLineTextMessage = sandbox.handleLineTextMessage;

function messageEvent(id, source) {
    return {
        webhookEventId: id,
        type: 'message',
        timestamp: Date.now(),
        source,
        message: { id: `message-${id}`, type: 'text', text: 'เบิกสินค้า 1 ลัง' }
    };
}

const handledSources = [];
sandbox.isDuplicateEvent = () => false;
sandbox.handleLineStatusReply = () => false;
sandbox.handleLineTextMessage = event => handledSources.push(event.source);
sandbox.jsonOutput = value => value;

sandbox.handleLineWebhook({
    events: [
        messageEvent('direct-user', { type: 'user', userId: 'U-DIRECT' }),
        messageEvent('room', { type: 'room', roomId: 'R-OTHER', userId: 'U-ROOM' }),
        messageEvent('wrong-group', { type: 'group', groupId: 'C-OTHER', userId: 'U-WRONG' }),
        messageEvent('target-group', { type: 'group', groupId: targetGroupId, userId: 'U-TARGET' })
    ]
});

assert.deepEqual(
    handledSources.map(sourceInfo => sourceInfo.groupId),
    [targetGroupId],
    'Only messages from the configured LINE group may reach requisition handlers'
);

console.log('PASS: strict target LINE group webhook ingress');

const appendedRows = [];
sandbox.parseLineRequisition = () => ({
    date: '2026-08-23',
    time: '10:00 น.',
    billType: 'เติมหน้าร้าน TRD',
    requester: 'หน้าร้าน TRD',
    itemsSummary: 'สินค้าทดสอบ 1 ลัง',
    skuCount: 1,
    totalUnits: 1
});
sandbox.getLineDisplayName = () => '';
sandbox.LockService = {
    getScriptLock: () => ({
        waitLock: () => {},
        releaseLock: () => {}
    })
};
sandbox.getSpreadsheet = () => ({});
sandbox.getOrCreateRequisitionsSheet = () => ({
    appendRow: row => appendedRows.push(row)
});
sandbox.computeDailyBillNo = () => appendedRows.length + 1;

originalHandleLineTextMessage(messageEvent('persist-direct', { type: 'user', userId: 'U-DIRECT' }));
originalHandleLineTextMessage(messageEvent('persist-wrong', { type: 'group', groupId: 'C-OTHER', userId: 'U-WRONG' }));
originalHandleLineTextMessage(messageEvent('persist-target', { type: 'group', groupId: targetGroupId, userId: 'U-TARGET' }));

assert.equal(appendedRows.length, 1, 'Persistence must reject missing and wrong Group IDs even when called directly');
assert.equal(appendedRows[0][14], targetGroupId, 'Persisted column O must contain the real source Group ID');

console.log('PASS: strict target group persistence without fallback');

function requisitionRow({ uid, date, groupId, sku = 1, units = 1, status = '⏳ รอจัดสินค้า' }) {
    return [
        uid,
        `#${uid}`,
        new Date('2026-08-23T03:00:00.000Z'),
        date,
        '10:00 น.',
        'เติมหน้าร้าน TRD',
        'ผู้ทดสอบ',
        'สินค้าทดสอบ',
        sku,
        units,
        status,
        '',
        '',
        'เบิกสินค้าทดสอบ',
        groupId,
        'U-TEST',
        `M-${uid}`
    ];
}

const persistedRows = [
    Array.from({ length: 17 }, (_, index) => `header-${index}`),
    requisitionRow({ uid: 'TARGET', date: '2026-08-23', groupId: targetGroupId, sku: 2, units: 5, status: 'จัดเสร็จแล้ว ✅' }),
    requisitionRow({ uid: 'WRONG', date: '2026-08-23', groupId: 'C-OTHER', sku: 3, units: 7 }),
    requisitionRow({ uid: 'BLANK', date: '2026-08-23', groupId: '', sku: 4, units: 9, status: 'สินค้าหมด / ไม่สำเร็จ ❌' }),
    requisitionRow({ uid: 'OTHER-DATE', date: '2026-08-22', groupId: targetGroupId, sku: 8, units: 11 })
];
sandbox.getSpreadsheet = () => ({
    getSheetByName: () => ({
        getDataRange: () => ({
            getValues: () => persistedRows
        })
    })
});

const dailyResult = sandbox.getLiveRequisitionsData('2026-08-23');
assert.deepEqual(
    Array.from(dailyResult.requisitions, row => String(row.uid)),
    ['TARGET'],
    'Daily API must return only rows persisted with the configured target Group ID'
);
assert.equal(dailyResult.stats.totalBills, 1, 'Cross-group rows must not affect total bill metrics');
assert.equal(dailyResult.stats.totalSKU, 2, 'Cross-group rows must not affect SKU metrics');
assert.equal(dailyResult.stats.totalUnits, 5, 'Cross-group rows must not affect unit metrics');
assert.equal(dailyResult.stats.completedBills, 1, 'Target-group completion metrics must remain intact');
assert.equal(dailyResult.stats.failedBills, 0, 'Blank-group failures must not affect target-group metrics');

console.log('PASS: persisted target group read and metric isolation');

function createWritableSheet(rows) {
    const writes = [];
    return {
        writes,
        getDataRange: () => ({ getValues: () => rows }),
        getRange: (row, column) => ({
            setValue: value => {
                writes.push({ row, column, value });
                return value;
            }
        })
    };
}

const mutationRows = [
    Array.from({ length: 17 }, (_, index) => `header-${index}`),
    requisitionRow({ uid: 'SAME-UID', date: '2026-08-23', groupId: targetGroupId }),
    requisitionRow({ uid: 'SAME-UID', date: '2026-08-23', groupId: 'C-OTHER' }),
    requisitionRow({ uid: 'WRONG-ONLY', date: '2026-08-23', groupId: 'C-OTHER' })
];
mutationRows[1][16] = 'SAME-MESSAGE';
mutationRows[2][16] = 'SAME-MESSAGE';
const mutationSheet = createWritableSheet(mutationRows);
sandbox.getSpreadsheet = () => ({ getSheetByName: () => mutationSheet });

assert.equal(
    sandbox.markRequisitionStatusByMessageId('SAME-MESSAGE', 'จัดเสร็จแล้ว ✅', 'คลัง', new Date()),
    true,
    'Target-group message status must be updateable'
);
assert.deepEqual(
    Array.from(new Set(mutationSheet.writes.map(write => write.row))),
    [2],
    'Message status mutation must skip a matching row from another LINE group'
);

mutationSheet.writes.length = 0;
const updateResult = sandbox.updateRequisitionStatus('SAME-UID', 'จัดเสร็จแล้ว ✅', 'คลัง');
assert.equal(updateResult.success, true, 'Target-group UID status must be updateable');
assert.deepEqual(
    Array.from(new Set(mutationSheet.writes.map(write => write.row))),
    [2],
    'UID status mutation must skip a matching row from another LINE group'
);

mutationSheet.writes.length = 0;
const wrongOnlyUpdate = sandbox.updateRequisitionStatus('WRONG-ONLY', 'จัดเสร็จแล้ว ✅', 'คลัง');
assert.equal(wrongOnlyUpdate.success, false, 'A UID outside the target group must not be updateable');
assert.equal(mutationSheet.writes.length, 0, 'Rejected cross-group UID mutation must perform zero writes');

const pendingRows = [
    Array.from({ length: 17 }, (_, index) => `header-${index}`),
    requisitionRow({ uid: 'TARGET-PENDING', date: '2026-08-23', groupId: targetGroupId }),
    requisitionRow({ uid: 'WRONG-PENDING', date: '2026-08-23', groupId: 'C-OTHER' })
];
const pendingSheet = createWritableSheet(pendingRows);
sandbox.getSpreadsheet = () => ({ getSheetByName: () => pendingSheet });
sandbox.Utilities = { formatDate: () => '2026-08-23' };
assert.equal(
    sandbox.markLatestPendingRequisitionStatus('จัดเสร็จแล้ว ✅', 'คลัง', new Date()),
    true,
    'Latest pending target-group requisition must be updateable'
);
assert.deepEqual(
    Array.from(new Set(pendingSheet.writes.map(write => write.row))),
    [2],
    'Latest-pending mutation must skip newer pending rows from another LINE group'
);

const dailyCountSheet = {
    getLastRow: () => 4,
    getRange: () => ({
        getValues: () => [
            ['2026-08-23', '', '', '', '', '', '', '', '', '', '', targetGroupId],
            ['2026-08-23', '', '', '', '', '', '', '', '', '', '', 'C-OTHER'],
            ['2026-08-22', '', '', '', '', '', '', '', '', '', '', targetGroupId]
        ]
    })
};
assert.equal(
    sandbox.computeDailyBillNo(dailyCountSheet, '2026-08-23'),
    2,
    'Daily bill numbering must count only target-group rows for the selected date'
);

console.log('PASS: target-group-only status mutations');
