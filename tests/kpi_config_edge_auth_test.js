const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const sourcePath = path.join(__dirname, '..', '..', 'database', 'supabase', 'functions', 'kpi-api', 'index.ts');

function loadHandler(fixtures) {
  let handler;
  let source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/^import[^\n]+\n/, '')
    .replace(/declare const Deno:[\s\S]*?;\n\n/, '')
    .replace(': string[] = []', ' = []')
    .replace(': Record<string, string> = {}', ' = {}')
    .replace(/Deno\.serve\(/, 'capture(');
  const context = {
    console: fixtures.console || console,
    Request,
    Response,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    __KPI_API_TEST_FIXTURES__: fixtures,
    Deno: { env: { get: name => fixtures.env?.[name] } },
    capture: value => { handler = value; }
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return { handler, dbCalls: fixtures.dbCalls };
}

async function call(handler, token = 'token', action = 'getConfig', origin = 'https://akra-web.github.io') {
  const response = await handler(new Request('https://example.test', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token })
  }));
  return { status: response.status, body: await response.json() };
}

(async () => {
  {
    const runtime = loadHandler({ dbCalls: [], verifyMainJwt: async () => null });
    const response = await runtime.handler(new Request('https://example.test', {
      method: 'OPTIONS',
      headers: { Origin: 'https://akra-web.github.io' }
    }));
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.headers.get('access-control-allow-origin'), 'https://akra-web.github.io');
    assert.match(response.headers.get('access-control-allow-headers') || '', /apikey/i);
  }

  {
    const fixtures = { dbCalls: [], verifyMainJwt: async () => null };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'forged');
    assert.strictEqual(result.status, 401);
    assert.strictEqual(runtime.dbCalls.length, 0, 'invalid JWT must make zero database queries');
  }

  for (const claims of [
    { id: 'worker', roles: ['WAREHOUSE'], mustChangePassword: true, exp: 9999999999 },
    { id: 'worker', roles: ['WAREHOUSE'], tokenVersion: 2, apps: [], exp: 9999999999 }
  ]) {
    const fixtures = { dbCalls: [], verifyMainJwt: async () => claims };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler);
    assert.strictEqual(result.status, 403);
    assert.strictEqual(runtime.dbCalls.length, 0, 'claim-level denial must make zero database queries');
  }

  {
    const fixtures = { dbCalls: [], verifyMainJwt: async () => ({ id: 'admin', roles: ['ADMIN'] }) };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'token', 'getConfig', 'https://evil.example');
    assert.strictEqual(result.status, 403);
    assert.strictEqual(runtime.dbCalls.length, 0, 'disallowed Origin must make zero database queries');
  }

  {
    const fixtures = {
      dbCalls: [],
      verifyMainJwt: async () => ({ id: 'worker', roles: ['ADMIN'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.worker')) {
          return [{ username: 'worker', name: 'Worker', roles: ['WAREHOUSE'], status: 'Active' }];
        }
        throw new Error(`unexpected domain read: ${table} ${query}`);
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'stale-admin-token', 'getAdminStatus');
    assert.strictEqual(result.status, 403, 'current Main role must override a stale ADMIN claim');
    assert.strictEqual(runtime.dbCalls.length, 1, 'denied stale admin may read only its current Main user row');
  }

  {
    const fixtures = {
      dbCalls: [],
      verifyMainJwt: async () => ({ id: 'inactive', roles: ['ADMIN'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        return [{ username: 'inactive', name: 'Inactive', roles: ['ADMIN'], status: 'Inactive' }];
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'inactive-token', 'getAdminStatus');
    assert.strictEqual(result.status, 403);
    assert.strictEqual(runtime.dbCalls.length, 1, 'inactive caller must be denied before roster/workload reads');
  }

  {
    const warnings = [];
    const fixtures = {
      dbCalls: [],
      console: { ...console, warn: (...args) => warnings.push(args) },
      verifyMainJwt: async () => ({ id: 'not-migrated', roles: ['WAREHOUSE'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        return [];
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'valid-main-token');
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.body.reason, 'permission_denied', 'client contract must remain unchanged');
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(warnings)),
      [['kpi-api request rejected', { action: 'getConfig', status: 403, stage: 'current_user_missing' }]],
      'safe diagnostics must identify the rejection stage without logging token or identity data'
    );
  }

  {
    const fixtures = {
      dbCalls: [],
      verifyMainJwt: async () => ({ id: 'worker', roles: ['WAREHOUSE'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.worker')) {
          return [{ username: 'worker', name: 'Worker', roles: ['WAREHOUSE'], status: 'Active' }];
        }
        if (table === 'users') return [
          { username: 'worker', name: 'Worker', roles: ['WAREHOUSE'], status: 'Active' },
          { username: 'cashier', name: 'Cashier', roles: ['CASHIER'], status: 'Active' }
        ];
        if (table === 'kpi_employees') return [];
        throw new Error(`non-admin must not read ${table}`);
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'worker-token', 'getConfig');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.employees.length, 2);
    assert.deepStrictEqual(Array.from(result.body.viewer.roles), ['WAREHOUSE']);
    assert.deepStrictEqual(Array.from(result.body.workload.recordedEmployees), []);
    assert.strictEqual(runtime.dbCalls.some(call => call.table === 'kpi_daily_records'), false);
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      verifyMainJwt: async () => ({
        id: 'worker', roles: ['WAREHOUSE'], apps: ['app-kpi'], tokenVersion: 2,
        sessionVersion: 7, authorizationRevision: 'rev-7', exp: 9999999999
      }),
      dbRpc: async (name, body) => {
        fixtures.rpcCalls.push({ name, body });
        return { valid: true };
      },
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.worker')) {
          return [{ username: 'worker', name: 'Worker', roles: ['WAREHOUSE'], status: 'Active' }];
        }
        if (table === 'users') return [{ username: 'worker', name: 'Worker', roles: ['WAREHOUSE'], status: 'Active' }];
        if (table === 'kpi_employees') return [];
        throw new Error(`unexpected table ${table}`);
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'valid-v2', 'getConfig');
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(Array.from(result.body.viewer.roles), ['WAREHOUSE']);
    assert.strictEqual(fixtures.rpcCalls.length, 1, 'v2 request must revalidate the current Main session once');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(fixtures.rpcCalls[0].body)), {
      p_username: 'worker', p_session_version: 7, p_authorization_revision: 'rev-7'
    });
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      verifyMainJwt: async () => ({
        id: 'worker', roles: ['WAREHOUSE'], apps: ['app-kpi'], tokenVersion: 2,
        sessionVersion: 7, authorizationRevision: 'revoked', exp: 9999999999
      }),
      dbRpc: async (name, body) => {
        fixtures.rpcCalls.push({ name, body });
        return { valid: false };
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'revoked-v2', 'getConfig');
    assert.strictEqual(result.status, 401);
    assert.strictEqual(fixtures.rpcCalls.length, 1);
    assert.strictEqual(runtime.dbCalls.length, 0, 'revoked v2 session must make zero roster/workload queries');
  }

  {
    const fixtures = {
      dbCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'), // 19:00 Bangkok
      verifyMainJwt: async () => ({ id: 'admin', roles: ['ADMIN'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users') return [
          { username: '250001', name: 'Somchai', roles: ['WAREHOUSE'], status: 'Active' },
          { username: '250002', name: 'Somsri', roles: ['Cashier'], status: 'Active' },
          { username: 'admin', name: 'Admin', roles: ['ADMIN'], status: 'Active' }
        ];
        if (table === 'kpi_employees') {
          assert.doesNotMatch(query, /gender/, 'Edge query must use the deployed kpi_employees schema');
          return [{ legacy_uid: '250001', name: 'Old Name', role: 'Legacy', branch: 'TRD' }];
        }
        if (table === 'kpi_daily_records') return [
          { record_date: '2026-08-22', workload_data: [{ employee: 'Somsri' }] },
          { record_date: '2026-08-23', workload_data: [{ employee: 'Somchai' }] }
        ];
        return [];
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'token', 'getAdminStatus');
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(Array.from(result.body.employees[0].roles), ['WAREHOUSE']);
    assert.strictEqual(result.body.employees[0].branches, 'AKRA', 'Main roles must override legacy KPI branch');
    assert.strictEqual(result.body.employees[1].branches, 'TRD');
    assert.deepStrictEqual(Array.from(result.body.workload.recordedEmployees), ['Somchai']);
    assert.strictEqual(result.body.workload.date, '2026-08-23');
    assert.strictEqual(result.body.workload.previousDate, '2026-08-22');
    assert.deepStrictEqual(Array.from(result.body.workload.previousRecordedEmployees), ['Somsri']);
    const workloadCall = fixtures.dbCalls.find(call => call.table === 'kpi_daily_records');
    assert.match(workloadCall.query, /record_date=in\.\(2026-08-22,2026-08-23\)/);
  }

  console.log('KPI config Edge auth and Main-roster projection passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
