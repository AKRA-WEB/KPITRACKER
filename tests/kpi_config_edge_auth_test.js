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

async function callPayload(handler, body, origin = 'https://akra-web.github.io') {
  const response = await handler(new Request('https://example.test', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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
    let migrated = false;
    const upserts = [];
    const fixtures = {
      dbCalls: [],
      verifyMainJwt: async () => ({ id: 'not-migrated', roles: ['STALE'], exp: 9999999999 }),
      verifyLegacyMainUser: async token => {
        assert.strictEqual(token, 'valid-main-token');
        return { id: 'not-migrated', name: 'Current Main User', roles: ['WAREHOUSE'], mustChangePassword: false };
      },
      dbUpsertUser: async user => {
        upserts.push(user);
        migrated = true;
      },
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.not-migrated')) {
          return migrated
            ? [{ username: 'not-migrated', name: 'Current Main User', roles: ['WAREHOUSE'], status: 'Active' }]
            : [];
        }
        if (table === 'users') {
          return [{ username: 'not-migrated', name: 'Current Main User', roles: ['WAREHOUSE'], status: 'Active' }];
        }
        if (table === 'kpi_employees') return [
          { legacy_uid: 'OLD_SHARED', canonical_uid: 'A', name: 'Shared Name', role: 'Legacy', branch: 'AKRA' }
        ];
        throw new Error(`unexpected table ${table}`);
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'valid-main-token');
    assert.strictEqual(result.status, 200, 'a currently authorized legacy Main user must migrate and continue');
    assert.deepStrictEqual(Array.from(result.body.viewer.roles), ['WAREHOUSE']);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(upserts)), [{
      username: 'not-migrated',
      name: 'Current Main User',
      roles: ['WAREHOUSE'],
      status: 'Active',
      is_migrated: true,
      legacy_uid: 'not-migrated',
      legacy_sheet_source: 'Main verify migration'
    }], 'migration must contain current Main identity fields and no credential');
  }

  {
    const warnings = [];
    const fixtures = {
      dbCalls: [],
      console: { ...console, warn: (...args) => warnings.push(args) },
      verifyMainJwt: async () => ({
        id: 'not-migrated-v2', roles: ['WAREHOUSE'], apps: ['app-kpi'], tokenVersion: 2,
        sessionVersion: 1, authorizationRevision: 'current', exp: 9999999999
      }),
      dbRpc: async () => ({ valid: true }),
      verifyLegacyMainUser: async () => assert.fail('v2 identities must never use legacy migration'),
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
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'),
      verifyMainJwt: async () => ({ id: 'ADMIN1', roles: ['ADMIN'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.ADMIN1')) {
          return [{ username: 'ADMIN1', name: 'Admin', roles: ['ADMIN'], status: 'Active' }];
        }
        if (table === 'users') return [
          { username: 'ADMIN1', name: 'Admin', roles: ['ADMIN'], status: 'Active' },
          { username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' },
          { username: 'A', name: 'Shared Name', roles: ['AKRA'], status: 'Active' },
          { username: 'B', name: 'Shared Name', roles: ['AKRA'], status: 'Active' }
        ];
        if (table === 'kpi_employees') return [];
        if (table === 'kpi_daily_records') return [
          { record_date: '2026-08-22', workload_data: [{ employee: 'หมูหยอง' }] },
          { record_date: '2026-08-23', workload_data: [{ employee: 'Shared Name' }] }
        ];
        return [];
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'token', 'getAdminStatus');
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(Array.from(result.body.workload.previousRecordedEmployeeUids), ['250007'],
      'a unique exact Main name must recover the stable UID for legacy name-only history');
    assert.deepStrictEqual(Array.from(result.body.workload.recordedEmployeeUids), [],
      'an ambiguous duplicate Main name must not be assigned to an arbitrary UID');
  }

  {
    let upsertCalls = 0;
    const fixtures = {
      dbCalls: [],
      verifyMainJwt: async () => ({ id: 'removed-user', roles: ['ADMIN'], exp: 9999999999 }),
      verifyLegacyMainUser: async () => null,
      dbUpsertUser: async () => { upsertCalls++; },
      dbRows: async () => []
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'removed-main-token');
    assert.strictEqual(result.status, 403);
    assert.strictEqual(upsertCalls, 0, 'a user rejected by current Main verification must never be migrated');
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
      now: new Date('2026-08-23T12:00:00.000Z'),
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
      now: new Date('2026-08-23T12:00:00.000Z'),
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

  {
    const fixtures = {
      dbCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'),
      verifyMainJwt: async () => ({ id: 'admin', roles: ['ADMIN'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.admin')) {
          return [{ username: 'admin', name: 'Admin', roles: ['ADMIN'], status: 'Active' }];
        }
        if (table === 'users') return [
          { username: 'admin', name: 'Admin', roles: ['ADMIN'], status: 'Active' },
          { username: 'AKRA12123', name: 'TRAINEE (SORN)', roles: ['AKRA'], status: 'Active' }
        ];
        if (table === 'kpi_employees') return [
          { legacy_uid: 'TRAINEE_SORN', canonical_uid: 'AKRA12123', name: 'SORN', role: 'Trainee', branch: 'AKRA' }
        ];
        if (table === 'kpi_daily_records') return [
          { record_date: '2026-08-22', workload_data: [{ employeeUid: 'TRAINEE_SORN', employee: 'SORN' }] },
          { record_date: '2026-08-23', workload_data: [{ employeeUid: 'AKRA12123', employee: 'TRAINEE (SORN)' }] }
        ];
        return [];
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'token', 'getAdminStatus');
    assert.strictEqual(result.status, 200);
    const frontline = result.body.employees.filter(employee => !employee.roles.includes('ADMIN'));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(frontline)), [{
      uid: 'AKRA12123', name: 'TRAINEE (SORN)', roles: ['AKRA'], branches: 'AKRA',
      dept: 'Trainee', gender: '', status: 'Active', aliasUids: ['TRAINEE_SORN'], aliasNames: ['SORN']
    }], 'the Edge roster must project only the current Main identity while retaining historical reconciliation metadata');
    assert.deepStrictEqual(Array.from(result.body.workload.previousRecordedEmployeeUids), ['AKRA12123']);
    assert.deepStrictEqual(Array.from(result.body.workload.recordedEmployeeUids), ['AKRA12123']);
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.250007')) {
          return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        }
        if (table === 'users') {
          const users = [
            { username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' },
            { username: 'TRAINEE_SORN', name: 'SORN', roles: ['WAREHOUSE'], status: 'Active' },
            { username: 'AKRA12123', name: 'TRAINEE (SORN)', roles: ['AKRA'], status: 'Inactive' }
          ];
          return query.includes('status=eq.Active') ? users.filter(user => user.status === 'Active') : users;
        }
        if (table === 'kpi_employees') return [
          { legacy_uid: 'TRAINEE_SORN', canonical_uid: 'AKRA12123', name: 'SORN', role: 'Trainee', branch: 'AKRA' }
        ];
        return [];
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await call(runtime.handler, 'token', 'getConfig');
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(
      Array.from(result.body.employees, employee => employee.uid),
      ['250007'],
      'an inactive canonical Main identity must not allow its Active legacy placeholder to reappear in the frontline roster'
    );
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.250007')) {
          return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        }
        throw new Error(`unexpected table ${table}`);
      },
      dbRpc: async (name, body) => {
        fixtures.rpcCalls.push({ name, body });
        return { status: 'success', workload: [body.p_entry] };
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-23',
      workload: {
        employee: 'ชื่อจาก Main ที่ต่างจาก roster', capacity: 10,
        outbound: 7, inbound: 3, transfer: 0, shared: 0,
        note: '', primaryCore: 'คลัง W1',
        supportDuties: [{ id: 123, icon: 'fa-test', name: 'แวะขึ้นของ', hours: 3 }]
      }
    });
    assert.strictEqual(result.status, 200, 'the same stable Main identity must be able to save its own Workload');
    assert.strictEqual(fixtures.rpcCalls.length, 1);
    assert.strictEqual(fixtures.rpcCalls[0].name, 'kpi_save_workload_entry_v1');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(fixtures.rpcCalls[0].body)), {
      p_record_date: '2026-08-23',
      p_username: '250007',
      p_entry: {
        employeeUid: '250007', employee: 'หมูหยอง', capacity: 10,
        outbound: 7, inbound: 3, transfer: 0, shared: 0,
        note: '', primaryCore: 'คลัง W1', supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }], updatedBy: '250007'
      }
    }, 'the server must bind the mutation to the current user and canonical roster name');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async () => { fixtures.dbCalls.push('unexpected'); return []; },
      dbRpc: async () => { fixtures.rpcCalls.push('unexpected'); return {}; }
    };
    const runtime = loadHandler(fixtures);
    const crossEmployee = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250008', date: '2026-08-23',
      workload: {
        capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0,
        primaryCore: 'คลัง W1', supportDuties: []
      }
    });
    assert.strictEqual(crossEmployee.status, 403);
    assert.strictEqual(crossEmployee.body.reason, 'permission_denied');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'cross-employee mutation must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'cross-employee mutation must make zero mutation calls');

    const invalidCapacity = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-23',
      workload: { capacity: 10, outbound: 9, inbound: 0, transfer: 0, shared: 0 }
    });
    assert.strictEqual(invalidCapacity.status, 400);
    assert.strictEqual(invalidCapacity.body.reason, 'invalid_workload');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'invalid Workload must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'invalid Workload must make zero mutation calls');

    const futureDate = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-24',
      workload: { capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0 }
    });
    assert.strictEqual(futureDate.status, 400);
    assert.strictEqual(futureDate.body.reason, 'invalid_workload');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'future Workload must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'future Workload must make zero mutation calls');

    const invalidDuty = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-23',
      workload: {
        capacity: 10, outbound: 6, inbound: 4, transfer: 0, shared: 0,
        primaryCore: 'คลัง W1', supportDuties: [{ name: 'แวะขึ้นของ', hours: 4 }]
      }
    });
    assert.strictEqual(invalidDuty.status, 400);
    assert.strictEqual(invalidDuty.body.reason, 'invalid_workload');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'invalid v2 duty duration must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'invalid v2 duty duration must make zero mutation calls');

    const excessiveSecondary = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-23',
      workload: {
        capacity: 10, outbound: 0, inbound: 10, transfer: 0, shared: 0,
        primaryCore: 'คลัง W1',
        supportDuties: [
          { name: 'แวะขึ้นของ', hours: 5 },
          { name: 'แวะไปส่งของ', hours: 5 },
          { name: 'ช่วยยกสินค้า', hours: 1 }
        ]
      }
    });
    assert.strictEqual(excessiveSecondary.status, 400);
    assert.strictEqual(fixtures.dbCalls.length, 0, 'secondary hours above capacity must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'secondary hours above capacity must make zero mutation calls');

    const invalidCore = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-23',
      workload: {
        capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0,
        primaryCore: 'UNRECOGNIZED', supportDuties: []
      }
    });
    assert.strictEqual(invalidCore.status, 400);
    assert.strictEqual(fixtures.dbCalls.length, 0, 'invalid primary core must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'invalid primary core must make zero mutation calls');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
      },
      dbRpc: async (name, body) => {
        fixtures.rpcCalls.push({ name, body });
        return {};
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveWorkload', token: 'valid-worker-token', employeeUid: '250007', date: '2026-08-23',
      workload: {
        capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0,
        primaryCore: 'คลัง W1', supportDuties: []
      }
    });
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.body.reason, 'database_error', 'malformed RPC success must fail closed');
  }

  {
    const fixtures = {
      dbCalls: [],
      now: new Date('2026-08-23T12:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users') return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        if (table === 'kpi_daily_records') {
          return [{ record_date: '2026-08-23', workload_data: [{ employeeUid: '250007', employee: 'หมูหยอง', capacity: 10 }] }];
        }
        throw new Error(`unexpected table ${table}`);
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'getWorkloadData', token: 'valid-worker-token', branch: 'AKRA', months: 3
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result.body.records)), [{
      date: '2026-08-23', workload: [{ employeeUid: '250007', employee: 'หมูหยอง', capacity: 10 }]
    }]);
    const workloadRead = fixtures.dbCalls.find(call => call.table === 'kpi_daily_records');
    assert.match(workloadRead.query, /branch=eq\.AKRA/);
    assert.match(workloadRead.query, /record_date=gte\.2026-06-01/);
    assert.match(workloadRead.query, /record_date=lte\.2026-08-23/);
  }

  {
    const fixtures = {
      dbCalls: [],
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async () => { fixtures.dbCalls.push('unexpected'); return []; }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'getWorkloadData', token: 'valid-worker-token', branch: 'TRD', months: 3
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.body.reason, 'invalid_workload_query');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'invalid Workload read scope must make zero database queries');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-24T03:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250002', roles: ['TRD'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users' && query.includes('username=eq.250002')) {
          return [{ username: '250002', name: 'ท็อป', roles: ['TRD'], status: 'Active' }];
        }
        if (table === 'users' && query.includes('status=eq.Active')) {
          return [
            { name: 'ท็อป', roles: ['TRD'], status: 'Active' },
            { name: 'น้องใหม่', roles: ['TRD'], status: 'Active' }
          ];
        }
        throw new Error(`unexpected table ${table}`);
      },
      dbRpc: async (name, body) => {
        fixtures.rpcCalls.push({ name, body });
        return { status: 'success', errors: body.p_entries };
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'valid-trd-token', branch: 'TRD', date: '2026-08-24',
      incident: {
        kind: 'case', caseId: 'ERR-2026-08-24-100-1', worker: 'น้องใหม่', participants: ['น้องใหม่'],
        roster: ['ท็อป', 'น้องใหม่'], category: 'trd_store', type: 'จัดบิลผิด', penalty: 5,
        note: 'บิล TRD-100', time: '10:00 น.'
      }
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(fixtures.rpcCalls.length, 1);
    assert.strictEqual(fixtures.rpcCalls[0].name, 'kpi_save_incident_v1');
    const rpcBody = JSON.parse(JSON.stringify(fixtures.rpcCalls[0].body));
    assert.strictEqual(rpcBody.p_record_date, '2026-08-24');
    assert.strictEqual(rpcBody.p_branch, 'TRD');
    assert.strictEqual(rpcBody.p_username, '250002');
    assert.strictEqual(rpcBody.p_entries.length, 1);
    assert.deepStrictEqual(rpcBody.p_entries[0].participants, ['น้องใหม่']);
    assert.strictEqual(rpcBody.p_entries[0].emp, 'น้องใหม่');
    assert.strictEqual(rpcBody.p_entries[0].caseId, 'ERR-2026-08-24-100-1');
    assert.match(rpcBody.p_entries[0].note, /\[TRD_CASE:/);
    assert.strictEqual(result.body.incidents.length, 1);
    assert.strictEqual(result.body.zeroConfirmed, false);
    assert.strictEqual(result.body.incidents[0].note, 'บิล TRD-100');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-24T03:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (query.includes('username=eq.250007')) {
          return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        }
        if (query.includes('status=eq.Active')) {
          return [
            { name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' },
            { name: 'เอี้ยง', roles: ['AKRA'], status: 'Active' }
          ];
        }
        throw new Error(`unexpected table ${table} ${query}`);
      },
      dbRpc: async (name, body) => {
        fixtures.rpcCalls.push({ name, body });
        return { status: 'success', errors: body.p_entries };
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'valid-akra-token', branch: 'AKRA', date: '2026-08-24',
      incident: {
        kind: 'case', caseId: 'ERR-2026-08-24-200-1', worker: 'ทุกคนในกะ',
        participants: ['หมูหยอง', 'เอี้ยง'], roster: ['หมูหยอง', 'เอี้ยง'],
        category: 'outbound', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 5,
        note: 'AKRA shared case', time: '10:05 น.'
      }
    });
    assert.strictEqual(result.status, 200);
    const entries = JSON.parse(JSON.stringify(fixtures.rpcCalls[0].body.p_entries));
    assert.deepStrictEqual(entries.map(entry => entry.emp), ['หมูหยอง', 'เอี้ยง']);
    assert.ok(entries.every(entry => entry.worker === 'ทุกคนในกะ'));
    assert.ok(entries.every(entry => entry.note.startsWith('[AKRA_CASE:')));
    assert.strictEqual(result.body.incidents.length, 1, 'expanded participant rows must project as one visible case');

    const zeroResult = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'valid-akra-token', branch: 'AKRA', date: '2026-08-23',
      incident: {
        kind: 'zero', caseId: 'NO_ERRORS', worker: 'SYSTEM', participants: ['SYSTEM'],
        category: 'none', type: 'ไม่มีความผิดพลาด', penalty: 0, note: '', time: ''
      }
    });
    assert.strictEqual(zeroResult.status, 200);
    assert.strictEqual(zeroResult.body.zeroConfirmed, true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(zeroResult.body.incidents)), []);
    assert.strictEqual(fixtures.rpcCalls[1].body.p_entries[0].caseId, 'NO_ERRORS');
    assert.match(fixtures.rpcCalls[1].body.p_entries[0].note, /^\[AKRA_CASE:/);
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-24T03:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async () => { fixtures.dbCalls.push('unexpected'); return []; },
      dbRpc: async () => { fixtures.rpcCalls.push('unexpected'); return {}; }
    };
    const runtime = loadHandler(fixtures);
    for (const incident of [
      { kind: 'case', caseId: 'bad', worker: 'หมูหยอง', participants: ['หมูหยอง'], roster: ['หมูหยอง'], category: 'outbound', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 5, note: '', time: '10:00 น.' },
      { kind: 'case', caseId: 'ERR-2026-08-24-1', worker: 'หมูหยอง', participants: ['หมูหยอง'], roster: ['หมูหยอง'], category: 'outbound', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 99, note: '', time: '10:00 น.' },
      { kind: 'case', caseId: 'ERR-2026-08-24-2', worker: 'หมูหยอง', participants: ['หมูหยอง'], roster: ['หมูหยอง'], category: 'outbound', type: 'UNKNOWN', penalty: 5, note: '', time: '10:00 น.' }
    ]) {
      const invalid = await callPayload(runtime.handler, {
        action: 'saveIncident', token: 'valid-akra-token', branch: 'AKRA', date: '2026-08-24', incident
      });
      assert.strictEqual(invalid.status, 400);
      assert.strictEqual(invalid.body.reason, 'invalid_incident');
    }
    const futureDate = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'valid-akra-token', branch: 'AKRA', date: '2026-08-25',
      incident: {
        kind: 'case', caseId: 'ERR-2026-08-25-1', worker: 'หมูหยอง', participants: ['หมูหยอง'],
        roster: ['หมูหยอง'], category: 'outbound', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 5,
        note: '', time: '10:00 น.'
      }
    });
    assert.strictEqual(futureDate.status, 400);
    assert.strictEqual(futureDate.body.reason, 'invalid_incident');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'invalid Incident payloads must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'invalid Incident payloads must make zero mutation calls');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-24T03:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
      },
      dbRpc: async () => { fixtures.rpcCalls.push('unexpected'); return {}; }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'valid-akra-token', branch: 'TRD', date: '2026-08-24',
      incident: {
        kind: 'case', caseId: 'ERR-2026-08-24-300-1', worker: 'ท็อป', participants: ['ท็อป'],
        roster: ['ท็อป'], category: 'trd_store', type: 'จัดบิลผิด', penalty: 5, note: '', time: '10:00 น.'
      }
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.body.reason, 'permission_denied');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'cross-branch claim denial must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'cross-branch Incident must not mutate data');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      now: new Date('2026-08-24T03:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250007', roles: ['AKRA'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (query.includes('username=eq.250007')) {
          return [{ username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        }
        if (query.includes('status=eq.Active')) {
          return [{ name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' }];
        }
        throw new Error(`unexpected table ${table} ${query}`);
      },
      dbRpc: async () => { fixtures.rpcCalls.push('unexpected'); return {}; }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'valid-akra-token', branch: 'AKRA', date: '2026-08-24',
      incident: {
        kind: 'case', caseId: 'ERR-2026-08-24-unknown-1', worker: 'บุคคลนอกสาขา',
        participants: ['บุคคลนอกสาขา'], roster: ['บุคคลนอกสาขา'],
        category: 'outbound', type: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 5, note: '', time: '10:00 น.'
      }
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.body.reason, 'invalid_incident');
    assert.strictEqual(fixtures.dbCalls.length, 2, 'personnel validation may read only current user and Active Main roster');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'unknown or cross-branch personnel must not mutate data');
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      verifyMainJwt: async () => null,
      dbRows: async () => { fixtures.dbCalls.push('unexpected'); return []; },
      dbRpc: async () => { fixtures.rpcCalls.push('unexpected'); return {}; }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'saveIncident', token: 'forged', branch: 'TRD', date: '2026-08-24',
      incident: {
        kind: 'case', caseId: 'ERR-2026-08-24-400-1', worker: 'ท็อป', participants: ['ท็อป'],
        roster: ['ท็อป'], category: 'trd_store', type: 'จัดบิลผิด', penalty: 5, note: '', time: '10:00 น.'
      }
    });
    assert.strictEqual(result.status, 401);
    assert.strictEqual(fixtures.dbCalls.length, 0, 'unauthorized Incident save must make zero database queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'unauthorized Incident save must make zero mutation calls');
  }

  {
    const fixtures = {
      dbCalls: [],
      now: new Date('2026-08-24T03:00:00.000Z'),
      verifyMainJwt: async () => ({ id: '250002', roles: ['TRD'], apps: ['app-kpi'], exp: 9999999999 }),
      dbRows: async (table, query) => {
        fixtures.dbCalls.push({ table, query });
        if (table === 'users') return [{ username: '250002', name: 'ท็อป', roles: ['TRD'], status: 'Active' }];
        if (table === 'kpi_daily_records') return [{
          record_date: '2026-08-24', errors_data: [{
            caseId: 'ERR-2026-08-24-100-1', kind: 'case', worker: 'น้องใหม่', participants: ['น้องใหม่'],
            category: 'trd_store', type: 'จัดบิลผิด', penalty: 5, displayNote: 'บิล TRD-100', time: '10:00 น.', emp: 'น้องใหม่'
          }]
        }];
        throw new Error(`unexpected table ${table}`);
      }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'getIncidentData', token: 'valid-trd-token', branch: 'TRD', months: 3
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.records[0].incidents.length, 1);
    assert.strictEqual(result.body.records[0].incidents[0].note, 'บิล TRD-100');
    assert.strictEqual(result.body.records[0].zeroConfirmed, false);
    const read = fixtures.dbCalls.find(call => call.table === 'kpi_daily_records');
    assert.match(read.query, /branch=eq\.TRD/);
    assert.match(read.query, /select=record_date,errors_data/);
  }

  {
    const fixtures = {
      dbCalls: [], rpcCalls: [],
      verifyMainJwt: async () => ({
        id: '250007', roles: ['AKRA'], apps: ['app-kpi'], tokenVersion: 2,
        sessionVersion: 1, authorizationRevision: 'current', exp: 9999999999
      }),
      dbRows: async () => { fixtures.dbCalls.push('unexpected'); return []; },
      dbRpc: async () => { fixtures.rpcCalls.push('unexpected'); return { valid: true }; }
    };
    const runtime = loadHandler(fixtures);
    const result = await callPayload(runtime.handler, {
      action: 'getIncidentData', token: 'valid-akra-token', branch: 'TRD', months: 3
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.body.reason, 'permission_denied');
    assert.strictEqual(fixtures.dbCalls.length, 0, 'cross-branch Incident read must make zero row queries');
    assert.strictEqual(fixtures.rpcCalls.length, 0, 'cross-branch Incident read must stop before v2 session RPC');
  }

  console.log('KPI config Edge auth and Main-roster projection passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
