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

async function callPayload(handler, body, origin = 'https://akra-web.github.io') {
  const response = await handler(new Request('https://example.test', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
}

(async () => {
  const today = '2026-08-25';
  const pastDate = '2026-08-24';
  const futureDate = '2026-08-26';

  const akraUser = { username: '250007', name: 'หมูหยอง', roles: ['AKRA'], status: 'Active' };
  const trdUser = { username: '250002', name: 'ท็อป', roles: ['TRD'], status: 'Active' };

  // 1. Test clearWorkload
  {
    let rpcCalled = false;
    let rpcArgs = null;
    const runtime = loadHandler({
      now: new Date(`${today}T05:00:00.000Z`),
      env: {
        KPI_ALLOWED_ORIGINS: 'https://akra-web.github.io',
        MAIN_JWT_SECRET: 'secret',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
      },
      verifyMainJwt: async token => {
        if (token === 'akra-token') return { id: '250007', name: 'หมูหยอง', roles: ['AKRA'], apps: ['app-kpi'], tokenVersion: 2 };
        if (token === 'trd-token') return { id: '250002', name: 'ท็อป', roles: ['TRD'], apps: ['app-kpi'], tokenVersion: 2 };
        return null;
      },
      dbRows: async (table, query) => {
        if (table === 'users' && query.includes('250007')) return [akraUser];
        if (table === 'users' && query.includes('250002')) return [trdUser];
        return [];
      },
      dbRpc: async (name, body) => {
        if (name === 'auth_validate_session_v1') return { valid: true };
        if (name === 'kpi_delete_workload_entry_v1') {
          rpcCalled = true;
          rpcArgs = body;
          return { status: 'success', workload: [] };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      }
    });

    // Successful same-day clearWorkload
    const successRes = await callPayload(runtime.handler, {
      action: 'clearWorkload',
      token: 'akra-token',
      date: today
    });
    assert.strictEqual(successRes.status, 200, 'clearWorkload same-day must succeed with 200');
    assert.strictEqual(rpcCalled, true, 'kpi_delete_workload_entry_v1 RPC must be called');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rpcArgs)), { p_record_date: today, p_username: '250007' });

    // Past date rejection
    const pastRes = await callPayload(runtime.handler, {
      action: 'clearWorkload',
      token: 'akra-token',
      date: pastDate
    });
    assert.strictEqual(pastRes.status, 400, 'clearWorkload for past date must be rejected with 400');

    // Future date rejection
    const futureRes = await callPayload(runtime.handler, {
      action: 'clearWorkload',
      token: 'akra-token',
      date: futureDate
    });
    assert.strictEqual(futureRes.status, 400, 'clearWorkload for future date must be rejected with 400');

    // Cross-employee rejection
    const crossRes = await callPayload(runtime.handler, {
      action: 'clearWorkload',
      token: 'akra-token',
      employeeUid: '250010',
      date: today
    });
    assert.strictEqual(crossRes.status, 403, 'clearWorkload for another employee must be rejected with 403');
  }

  // 2. Test deleteIncident
  {
    let rpcCalled = false;
    let rpcArgs = null;
    const runtime = loadHandler({
      now: new Date(`${today}T05:00:00.000Z`),
      env: {
        KPI_ALLOWED_ORIGINS: 'https://akra-web.github.io',
        MAIN_JWT_SECRET: 'secret',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
      },
      verifyMainJwt: async token => {
        if (token === 'akra-token') return { id: '250007', name: 'หมูหยอง', roles: ['AKRA'], apps: ['app-kpi'], tokenVersion: 2 };
        if (token === 'trd-token') return { id: '250002', name: 'ท็อป', roles: ['TRD'], apps: ['app-kpi'], tokenVersion: 2 };
        return null;
      },
      dbRows: async (table, query) => {
        if (table === 'users' && query.includes('250007')) return [akraUser];
        if (table === 'users' && query.includes('250002')) return [trdUser];
        return [];
      },
      dbRpc: async (name, body) => {
        if (name === 'auth_validate_session_v1') return { valid: true };
        if (name === 'kpi_delete_incident_case_v1') {
          rpcCalled = true;
          rpcArgs = body;
          return { status: 'success', errors: [] };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      }
    });

    const caseIdToday = `ERR-${today}-12345`;
    const caseIdPast = `ERR-${pastDate}-12345`;

    // Successful same-day deleteIncident for AKRA
    const successRes = await callPayload(runtime.handler, {
      action: 'deleteIncident',
      token: 'akra-token',
      branch: 'AKRA',
      caseId: caseIdToday
    });
    assert.strictEqual(successRes.status, 200, 'deleteIncident same-day must succeed with 200');
    assert.strictEqual(rpcCalled, true, 'kpi_delete_incident_case_v1 RPC must be called');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rpcArgs)), {
      p_record_date: today,
      p_branch: 'AKRA',
      p_username: '250007',
      p_case_id: caseIdToday
    });

    // Past date case rejection
    const pastRes = await callPayload(runtime.handler, {
      action: 'deleteIncident',
      token: 'akra-token',
      branch: 'AKRA',
      caseId: caseIdPast
    });
    assert.strictEqual(pastRes.status, 400, 'deleteIncident for past date must be rejected with 400');

    // Branch permission mismatch (TRD user attempting to delete AKRA incident)
    const branchMismatchRes = await callPayload(runtime.handler, {
      action: 'deleteIncident',
      token: 'trd-token',
      branch: 'AKRA',
      caseId: caseIdToday
    });
    assert.strictEqual(branchMismatchRes.status, 403, 'deleteIncident across unauthorized branch must return 403');
  }

  console.log('PASS: kpi_cancellation_edge_auth_test passed 100%!');
})();
