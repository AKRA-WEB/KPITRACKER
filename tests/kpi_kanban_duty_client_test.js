const assert = require('node:assert/strict');
const client = require('../js/supabase-kpi-client.js');

(async () => {
  const calls = [];
  const oldFetch = global.fetch;

  global.fetch = async (url, options) => {
    assert.ok(url.endsWith('/functions/v1/kpi-api'));
    const req = JSON.parse(options.body);
    calls.push(req);

    if (req.action === 'getKanbanBoard') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          branch: req.branch,
          tasks: [{ actionId: 'KB-1', title: 'Task 1', status: 'Open', revision: 1 }],
          counts: { open: 1, inProgress: 0, blocked: 0, resolved: 0 }
        })
      };
    }

    if (req.action === 'saveKanbanTask') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          actionId: req.taskItem.actionId,
          task: { ...req.taskItem, revision: (req.expectedRevision || 0) + 1 }
        })
      };
    }

    if (req.action === 'claimIssueTask') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          actionId: 'KB-CLAIM-1',
          task: { actionId: 'KB-CLAIM-1', sourceIssueId: req.issueId, ownerUid: req.ownerUid, status: 'In Progress' }
        })
      };
    }

    if (req.action === 'getDutyMatrix') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          branch: req.branch,
          catalog: [{ id: 'inbound', name: 'ขาเข้า รับสินค้าเข้า', weight: 2 }],
          assignments: [],
          capacities: [],
          employees: []
        })
      };
    }

    if (req.action === 'setDutyAssignment') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          catalog: [],
          assignments: [{ dutyId: req.dutyId, employeeUid: req.employeeUid, assignmentType: req.targetType }],
          capacities: [],
          employees: []
        })
      };
    }

    if (req.action === 'saveDutyCatalog') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          duty: { id: req.dutyId, name: req.name, weight: req.weight, isActive: req.isActive }
        })
      };
    }

    if (req.action === 'setDrivingCapabilities') {
      return {ok:true,json:async()=>({status:'success',capabilities:req.capabilities,revision:req.expectedRevision+1})};
    }
    if (req.action === 'setDutyCapacity') {
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          employeeUid: req.employeeUid,
          capacityWeight: req.capacityWeight
        })
      };
    }

    return { ok: false, status: 400, json: async () => ({ status: 'error', reason: 'unknown_action' }) };
  };

  try {
    // 1. getKanbanBoard
    const board = await client.getKanbanBoard('mock-token', 'AKRA');
    assert.equal(board.status, 'success');
    assert.equal(board.tasks.length, 1);
    assert.equal(calls.at(-1).action, 'getKanbanBoard');

    // 2. saveKanbanTask
    const saved = await client.saveKanbanTask('mock-token', { actionId: 'KB-1', title: 'Task 1', status: 'Open' }, 1);
    assert.equal(saved.status, 'success');
    assert.equal(saved.task.revision, 2);
    assert.equal(calls.at(-1).expectedRevision, 1);

    // 3. claimIssueTask
    const claimed = await client.claimIssueTask('mock-token', { branch: 'AKRA', issueId: 'IS-101', title: 'Broken', ownerUid: 'u1' });
    assert.equal(claimed.status, 'success');
    assert.equal(claimed.task.sourceIssueId, 'IS-101');

    // 4. getDutyMatrix
    const matrix = await client.getDutyMatrix('mock-token', 'AKRA');
    assert.equal(matrix.status, 'success');
    assert.equal(matrix.catalog[0].id, 'inbound');

    // 5. setDutyAssignment
    const assign = await client.setDutyAssignment('mock-token', { branch: 'AKRA', employeeUid: 'u1', dutyId: 'inbound', targetType: 'primary' });
    assert.equal(assign.status, 'success');
    assert.equal(assign.assignments[0].assignmentType, 'primary');

    // 6. saveDutyCatalog
    const cat = await client.saveDutyCatalog('mock-token', { branch: 'AKRA', dutyId: 'new-duty', name: 'New Duty', weight: 2, isActive: true });
    assert.equal(cat.status, 'success');
    assert.equal(cat.duty.id, 'new-duty');

    // 7. setDutyCapacity
    const cap = await client.setDutyCapacity('mock-token', { branch: 'AKRA', employeeUid: 'u1', capacityWeight: 5 });
    assert.equal(cap.status, 'success');
    assert.equal(cap.capacityWeight, 5);

    const skills={motorcycle:'capable',cargo34:'supervised',car_pickup:'unknown'};
    const driving=await client.setDrivingCapabilities('mock-token',{branch:'TRD',employeeUid:'u1',capabilities:skills,expectedRevision:3});
    assert.equal(driving.revision,4);assert.deepEqual(driving.capabilities,skills);
    assert.equal(calls.at(-1).token,'mock-token');assert.equal(calls.at(-1).branch,'TRD');assert.equal(calls.at(-1).expectedRevision,3);
    console.log('ALL KPI KANBAN AND DUTY CLIENT TESTS PASSED!');
  } finally {
    global.fetch = oldFetch;
  }
})();
