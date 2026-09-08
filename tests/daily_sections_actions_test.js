const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = require('../js/supabase-kpi-client.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = name => {
  const start = html.search(new RegExp('        (?:async )?function ' + name + '\\('));
  const end = html.indexOf('\n        }', start) + '\n        }'.length;
  assert.ok(start >= 0); return html.slice(start, end);
};
(async () => {
  const calls = [], storage = new Map();
  let mode = 'read';
  const oldFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.ok(url.endsWith('/functions/v1/kpi-api'));
    const req = JSON.parse(options.body); calls.push(req);
    if (mode === 'fail') return { ok: false, status: 409, json: async () => ({ status: 'error', reason: 'record_conflict' }) };
    if (req.action === 'getDailyData') return { ok: true, json: async () => ({ status: 'success', records: [{ date: req.cursor || '2026-09-07' }], nextCursor: req.cursor ? null : '2026-09-08' }) };
    if (req.action === 'saveSection') return { ok: true, json: async () => ({ status: 'success', record: { date: '2026-09-07', tasks: req.tasks, sectionRevisions: { tasks: req.expectedRevision + 1 } } }) };
    return { ok: true, json: async () => ({ status: 'success', actions: [], nextCursor: null, actionItem: { ...req.actionItem, revision: 2 } }) };
  };
  try {
    const result = await client.fetchBranchData('token', 'AKRA', 3);
    assert.equal(result.length, 2); assert.equal(calls.length, 2); assert.equal(calls[1].cursor, '2026-09-08');
    const count = calls.length; await assert.rejects(client.fetchBranchData('', 'AKRA'), /authenticated/); assert.equal(calls.length, count);
    storage.set('kpiData_AKRA', JSON.stringify([{ date: '2026-09-07', errors: [{ caseId: 'keep' }], sectionRevisions: { tasks: 3 } }]));
    const ctx = { console, Date, Map, JSON, Error, sectionEditRevisions: new Map(), currentUser: 'a', currentBranch: 'AKRA', AkraSupabaseKPI: client, sessionToken: 'token', safeStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
    vm.createContext(ctx);
    vm.runInContext(source('mergeDailySectionsIntoCache') + source('sectionEditKey') + source('captureSectionRevision') + source('postToKpiApi'), ctx);
    ctx.captureSectionRevision('2026-09-09', 'tasks');
    storage.set(ctx.sectionEditKey('AKRA', '2026-09-09'), JSON.stringify({ tasks: 99 })); // Another tab changes shared storage.
    ctx.mergeDailySectionsIntoCache('AKRA', [{ date: '2026-09-07', sectionRevisions: { tasks: 8 } }]);
    await ctx.postToKpiApi({ action: 'saveSection', branch: 'AKRA', date: '2026-09-09', section: 'tasks', tasks: [] });
    assert.equal(calls.at(-1).expectedRevision, 3);
    assert.equal(JSON.parse(storage.get('kpiData_AKRA'))[0].errors[0].caseId, 'keep');
    assert.equal(JSON.parse(storage.get('kpiData_AKRA'))[0].sectionRevisions.tasks, 4);
    mode = 'fail'; const before = storage.get('kpiData_AKRA');
    await assert.rejects(ctx.postToKpiApi({ action: 'saveSection', branch: 'AKRA', date: '2026-09-09', section: 'tasks', tasks: [] }), error => error.status === 409 && error.reason === 'record_conflict');
    assert.equal(storage.get('kpiData_AKRA'), before);
    await assert.rejects(ctx.postToKpiApi({ action: 'saveSection', section: 'errors' }));
    mode = 'read'; await client.saveAction('token', { actionId: 'x', revision: 7 }); assert.equal(calls.at(-1).expectedRevision, 7);
    const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'))).version;
    assert.equal(/CURRENT_VERSION\s*=\s*['"]([^'"]+)/.exec(html)[1], version);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc=/.test(match[1]) && match[2].trim()) new vm.Script(match[2]);
    console.log('PASS actual client pagination/auth, weekly revision/cache merge, conflict no fallback, action revision and inline syntax/version parity');
  } finally { global.fetch = oldFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
