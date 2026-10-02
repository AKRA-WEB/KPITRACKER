const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(matrices, { writable = false, combined = false } = {}) {
  const elements = new Map(), writes = [], reads = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', value: '', classList: { add() {}, remove() {}, toggle() {} },
      querySelectorAll: () => [], addEventListener() {}, focus() {}
    });
    return elements.get(id);
  };
  const document = { getElementById: element, querySelectorAll: () => [], body: { style: {} } };
  const api = new Proxy({}, { get(_target, method) {
    if (method === 'getDutyMatrix') return async (token, branch) => {
      assert.equal(token, 'fixture');
      reads.push(branch);
      return matrices[branch];
    };
    return async (...args) => { writes.push({ method, args }); throw Error('Unexpected mutation'); };
  } });
  const window = {
    AkraSupabaseKPI: api, addEventListener() {}, confirm: () => true,
    getKpiTaskContext: () => ({
      token: 'fixture', branch: 'AKRA', userUid: 'u1',
      roles: combined ? ['SUPERVISOR'] : ['WAREHOUSE'],
      allowedBranches: combined ? ['AKRA', 'TRD'] : ['AKRA'], can: () => writable
    })
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/kpi-duty-matrix.js'), 'utf8'),
    vm.createContext({ window, document, console, structuredClone, crypto: require('node:crypto').webcrypto }));
  return { controller: window.KpiDutyMatrix, element, writes, reads };
}

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const duty = (id, target, weight = 2) => ({ id, name: `Duty ${id}`, weight, targetHeadcount: target, isActive: true, revision: 7 });
const person = id => ({ employeeUid: id, name: `Person ${id}` });
const assignment = (uid, dutyId, type) => ({ employeeUid: uid, dutyId, assignmentType: type });
const matrix = patch => ({ catalog: [], employees: [], assignments: [], capacities: [], employeeRevisions: {}, ...patch });
const dutyBlock = (html, id) => html.split(`data-duty-coverage="${id}"`)[1].split('</th>')[0];
const personBlock = (html, id) => html.split(`data-person-weight="${id}"`)[1].split('</td>')[0];

test('unset criteria render unknown assessment and preserve read-only allocations', async () => {
  const row = matrix({ catalog: [duty('a', null)], employees: [person('u1')], assignments: [assignment('u1', 'a', 'secondary')] });
  const original = JSON.stringify(row), ui = setup({ AKRA: row });
  await ui.controller.loadDutyMatrix();
  const html = ui.element('kb-duty-content').innerHTML, summary = text(ui.element('kb-duty-summary').innerHTML);
  assert.match(summary, /ยังประเมินจำนวนคนไม่ได้/);
  assert.match(summary, /ยังประเมินภาระไม่ได้/);
  assert.doesNotMatch(summary, /0 หน้าที่ขาดคน|0 คนเกินขีดจำกัด/);
  assert.match(text(html), /ยังไม่ตั้งเป้าจำนวนคน 1\/1 หน้าที่/);
  assert.match(text(html), /ยังไม่ตั้งขีดจำกัด 1\/1 คน/);
  assert.match(text(dutyBlock(html, 'a')), /หลัก 0 · เสริม 1.*ยังไม่มีผู้รับหลัก/);
  assert.match(text(personBlock(html, 'u1')), /ยังไม่ตั้งขีดจำกัด/);
  assert.doesNotMatch(personBlock(html, 'u1'), /style="width:/);
  assert.match(text(html), /2 น้ำหนักรวม/);
  assert.equal(JSON.stringify(row), original);
  assert.equal(ui.writes.length, 0);
});

test('mixed targets and capacities assess only configured values, including zero', async () => {
  const row = matrix({
    catalog: [duty('a', 3), duty('b', null, 1), duty('c', 0, 3), duty('d', null)],
    employees: ['u1', 'u2', 'u3', 'u4'].map(person),
    assignments: [assignment('u1', 'a', 'primary'), assignment('u2', 'a', 'secondary'), assignment('u2', 'b', 'secondary')],
    capacities: [{ employeeUid: 'u1', capacityWeight: 0 }, { employeeUid: 'u2', capacityWeight: 5 }, { employeeUid: 'u3', capacityWeight: 0 }]
  });
  const original = JSON.stringify(row), ui = setup({ AKRA: row });
  await ui.controller.loadDutyMatrix();
  const html = ui.element('kb-duty-content').innerHTML, summary = text(ui.element('kb-duty-summary').innerHTML);
  assert.match(summary, /1 หน้าที่ขาดคน · ประเมิน 2\/4 หน้าที่/);
  assert.match(summary, /1 คนเกินขีดจำกัด · ประเมิน 3\/4 คน/);
  assert.match(text(html), /ยังไม่ตั้งเป้าจำนวนคน 2\/4 หน้าที่/);
  assert.match(text(html), /ยังไม่ตั้งขีดจำกัด 1\/4 คน/);
  assert.match(text(dutyBlock(html, 'a')), /2 คน \/ เป้า 3 · ขาด 1 คน.*หลัก 1 · เสริม 1/);
  assert.match(text(dutyBlock(html, 'c')), /0 คน \/ เป้า 0.*หลัก 0 · เสริม 0.*ยังไม่มีผู้รับหน้าที่/);
  assert.doesNotMatch(dutyBlock(html, 'c'), /ยังไม่ตั้งเป้าจำนวนคน|ยังไม่มีผู้รับหลัก/);
  assert.match(personBlock(html, 'u1'), /width: 100%/);
  assert.match(text(personBlock(html, 'u1')), /2 \/ 0.*เกินขีดจำกัด/);
  assert.match(personBlock(html, 'u3'), /width: 0%/);
  assert.match(text(personBlock(html, 'u3')), /0 \/ 0.*อยู่ในขีดจำกัด/);
  assert.doesNotMatch(personBlock(html, 'u4'), /width:/);
  assert.match(text(html), /5 น้ำหนักรวม/);
  ui.controller.setFilter('over');
  const filtered = ui.element('kb-duty-content').innerHTML;
  assert.match(filtered, /Person u1/);
  assert.doesNotMatch(filtered, /Person u2|Person u3|Person u4/);
  assert.equal(JSON.stringify(row), original);
  assert.equal(ui.writes.length, 0);
});

test('fully configured zero target and zero capacity report evaluated zero results', async () => {
  const ui = setup({ AKRA: matrix({ catalog: [duty('zero', 0)], employees: [person('u1')], capacities: [{ employeeUid: 'u1', capacityWeight: 0 }] }) });
  await ui.controller.loadDutyMatrix();
  const summary = text(ui.element('kb-duty-summary').innerHTML);
  assert.match(summary, /0 หน้าที่ขาดคน · ประเมิน 1\/1 หน้าที่/);
  assert.match(summary, /0 คนเกินขีดจำกัด · ประเมิน 1\/1 คน/);
  assert.doesNotMatch(ui.element('kb-duty-content').innerHTML, /ยังไม่ตั้งเป้าจำนวนคน|ยังไม่ตั้งขีดจำกัด|NaN|Infinity/);
  assert.equal(ui.writes.length, 0);
});

test('empty catalogs and rosters show meaningful empty assessment instead of a healthy zero', async () => {
  const ui = setup({ AKRA: matrix({}) });
  await ui.controller.loadDutyMatrix();
  const summary = text(ui.element('kb-duty-summary').innerHTML), html = ui.element('kb-duty-content').innerHTML;
  assert.match(summary, /ยังไม่มีหน้าที่ให้ประเมิน/);
  assert.match(summary, /ยังไม่มีพนักงานให้ประเมิน/);
  assert.match(text(html), /ยังไม่มีหน้าที่ในสาขานี้/);
  assert.match(text(html), /ยังไม่มีพนักงานในสาขานี้/);
  assert.doesNotMatch(summary, /0 หน้าที่ขาดคน|0 คนเกินขีดจำกัด/);
  assert.equal(ui.writes.length, 0);
});

test('desktop and mobile coverage count people once and flag only covered duties without a primary', async () => {
  const row = matrix({
    catalog: [duty('a', null), duty('b', null), duty('c', null)], employees: ['u1', 'u2', 'u3'].map(person),
    assignments: [assignment('u1', 'a', 'primary'), assignment('u2', 'a', 'primary'), assignment('u2', 'a', 'primary'), assignment('u3', 'b', 'secondary'), assignment('former-user', 'b', 'primary')]
  });
  const ui = setup({ AKRA: row });
  await ui.controller.loadDutyMatrix();
  const html = ui.element('kb-duty-content').innerHTML;
  assert.match(text(dutyBlock(html, 'a')), /2 คน.*หลัก 2 · เสริม 0/);
  assert.doesNotMatch(dutyBlock(html, 'a'), /ยังไม่มีผู้รับหลัก/);
  assert.match(text(dutyBlock(html, 'b')), /1 คน.*หลัก 0 · เสริม 1.*ยังไม่มีผู้รับหลัก/);
  assert.doesNotMatch(dutyBlock(html, 'c'), /ยังไม่มีผู้รับหลัก/);
  const mobileCoverage = html.split('aria-label="ความครอบคลุมหน้าที่ AKRA"')[1].split('</details>')[0];
  assert.match(text(mobileCoverage), /ความครอบคลุมหน้าที่ · 3 หน้าที่/);
  assert.match(text(mobileCoverage), /Duty a.*หลัก 2 · เสริม 0.*Duty b.*หลัก 0 · เสริม 1.*ยังไม่มีผู้รับหลัก.*Duty c.*หลัก 0 · เสริม 0/);
  assert.match(text(html), /1 หน้าที่มีผู้รับ แต่ยังไม่มีผู้รับหลัก/);
  assert.match(text(html), /6 น้ำหนักรวม/);
  assert.equal(ui.writes.length, 0);
});

test('combined branches keep assessment and primary counts separate even with shared IDs', async () => {
  const rows = {
    AKRA: matrix({ catalog: [duty('d', null)], employees: [person('u1')], assignments: [assignment('u1', 'd', 'secondary')] }),
    TRD: matrix({ catalog: [duty('d', 1)], employees: [person('u1')], assignments: [assignment('u1', 'd', 'primary')], capacities: [{ employeeUid: 'u1', capacityWeight: 2 }] })
  };
  const original = JSON.stringify(rows), ui = setup(rows, { combined: true });
  await ui.controller.setBranchScope('ALL');
  const html = ui.element('kb-duty-content').innerHTML;
  const akra = html.split('aria-label="ตารางงานสาขา AKRA"')[1].split('aria-label="ตารางงานสาขา TRD"')[0];
  const trd = html.split('aria-label="ตารางงานสาขา TRD"')[1];
  assert.match(text(akra), /ยังประเมินจำนวนคนไม่ได้.*ยังประเมินภาระไม่ได้/);
  assert.match(text(dutyBlock(akra, 'd')), /หลัก 0 · เสริม 1.*ยังไม่มีผู้รับหลัก/);
  assert.match(text(trd), /0 หน้าที่ขาดคน · ประเมิน 1\/1 หน้าที่.*0 คนเกินขีดจำกัด · ประเมิน 1\/1 คน/);
  assert.match(text(dutyBlock(trd, 'd')), /หลัก 1 · เสริม 0/);
  assert.doesNotMatch(dutyBlock(trd, 'd'), /ยังไม่มีผู้รับหลัก/);
  assert.match(html, /ความครอบคลุมหน้าที่ AKRA/);
  assert.match(html, /ความครอบคลุมหน้าที่ TRD/);
  assert.deepEqual(ui.reads, ['AKRA', 'TRD']);
  assert.equal(JSON.stringify(rows), original);
  assert.equal(ui.writes.length, 0);
});

test('local primary demotion refreshes coverage without changing confirmed assignments or writing', async () => {
  const row = matrix({ catalog: [duty('a', 1), duty('b', 1)], employees: [person('u1')], assignments: [assignment('u1', 'a', 'primary')], employeeRevisions: { u1: 8 } });
  const original = JSON.stringify(row), ui = setup({ AKRA: row }, { writable: true });
  await ui.controller.loadDutyMatrix();
  await ui.controller.cycleAssignment('u1', 'b');
  await ui.controller.cycleAssignment('u1', 'b');
  let html = ui.element('kb-duty-content').innerHTML;
  assert.match(text(dutyBlock(html, 'a')), /หลัก 0 · เสริม 1.*ยังไม่มีผู้รับหลัก/);
  assert.match(text(dutyBlock(html, 'b')), /หลัก 1 · เสริม 0/);
  assert.match(text(html), /4 น้ำหนักรวม/);
  assert.equal(ui.controller.hasDrafts(), true);
  ui.controller.discardDrafts();
  html = ui.element('kb-duty-content').innerHTML;
  assert.match(text(dutyBlock(html, 'a')), /หลัก 1 · เสริม 0/);
  assert.match(text(dutyBlock(html, 'b')), /หลัก 0 · เสริม 0/);
  assert.equal(ui.controller.hasDrafts(), false);
  assert.equal(JSON.stringify(row), original);
  assert.equal(ui.writes.length, 0);
});
