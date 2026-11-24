import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeatAlerts } from '../src/heartbeat.mjs';
import { syncIncident } from '../src/incidents.mjs';

const now = new Date('2026-11-24T10:00:00Z');
const scheduled = { event: 'schedule', status: 'completed', conclusion: 'success', updated_at: '2026-11-24T09:00:00Z' };

test('heartbeat requires a recent successful schedule, not a manual run or failed schedule', () => {
  assert.deepEqual(heartbeatAlerts([scheduled], now), []);
  for (const runs of [[], [{ ...scheduled, event: 'workflow_dispatch' }],
    [{ ...scheduled, conclusion: 'failure' }], [{ ...scheduled, updated_at: '2026-11-24T06:59:59Z' }]]) {
    assert.equal(heartbeatAlerts(runs, now).length, 1);
  }
  assert.deepEqual(heartbeatAlerts([{ ...scheduled, updated_at: '2026-11-24T07:00:00Z' }], now), []);
  assert.throws(() => heartbeatAlerts([{ ...scheduled, updated_at: 'bad' }], now), /invalid/);
  assert.throws(() => heartbeatAlerts([{ ...scheduled, updated_at: '2026-11-25T00:00:00Z' }], now), /future/);
});

test('incidents deduplicate unchanged failures, update changes, and close on recovery', async () => {
  let issue;
  const writes = [];
  const request = async (method, path, fields) => {
    if (method === 'GET') return issue?.state === 'open' ? [issue] : [];
    writes.push({ method, fields });
    issue = { number: 1, user: { login: 'github-actions[bot]' }, state: 'open', ...issue, ...fields };
    return issue;
  };
  await syncIncident('test', ['failure'], { request });
  await syncIncident('test', ['failure'], { request });
  assert.equal(writes.length, 1);
  await syncIncident('test', ['different failure'], { request });
  assert.equal(writes.length, 2);
  await syncIncident('test', [], { request });
  assert.equal(issue.state, 'closed');
  await syncIncident('test', [], { request });
  assert.equal(writes.length, 3);
});

test('API failure is surfaced, not reported as a successful heartbeat or notification', async () => {
  await assert.rejects(syncIncident('test', [], {
    request: async () => { throw new Error('HTTP 503'); },
  }), /503/);
});
