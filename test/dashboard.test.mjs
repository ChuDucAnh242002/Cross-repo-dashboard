import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDashboard, collectRepository, healthAlerts, renderHtml, renderSummary } from '../src/dashboard.mjs';

const now = new Date('2026-11-23T12:00:00Z');
const config = { repo: 'owner/project', workflow: 'ci.yml' };

function fakeFetch({ runs = [], jobs = [], total = runs.length, isPrivate = false, failJobs = false } = {}) {
  return async url => {
    const path = new URL(url).pathname;
    if (path === '/repos/owner/project') {
      return Response.json({ private: isPrivate, default_branch: 'main' });
    }
    if (path.endsWith('/workflows/ci.yml/runs')) {
      return Response.json({ total_count: total, workflow_runs: runs });
    }
    if (path.endsWith('/attempts/2/jobs')) {
      return failJobs ? new Response('', { status: 503 }) : Response.json({ total_count: jobs.length, jobs });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
}

test('collects recent results, excludes cancelled runs from pass rate, and measures jobs', async () => {
  const runs = [
    { id: 1, status: 'completed', conclusion: 'success', run_attempt: 2, created_at: '2026-11-23T10:00:00Z', run_started_at: '2026-11-23T10:01:00Z', updated_at: '2026-11-23T10:11:00Z', html_url: 'https://github.com/owner/project/actions/runs/1' },
    { id: 2, status: 'completed', conclusion: 'failure', run_attempt: 1, created_at: '2026-11-22T10:00:00Z', run_started_at: '2026-11-22T10:00:00Z', updated_at: '2026-11-22T10:20:00Z' },
    { id: 3, status: 'completed', conclusion: 'cancelled', run_attempt: 1, created_at: '2026-11-21T10:00:00Z', run_started_at: '2026-11-21T10:00:00Z', updated_at: '2026-11-21T10:01:00Z' },
    { id: 4, status: 'completed', conclusion: 'success', run_attempt: 1, created_at: '2026-10-01T10:00:00Z' },
  ];
  const jobs = [{ name: 'test', status: 'completed', conclusion: 'success', runner_name: 'runner', labels: ['ubuntu'], created_at: '2026-11-23T10:00:00Z', started_at: '2026-11-23T10:02:00Z' }];
  const result = await collectRepository(config, { now, fetchImpl: fakeFetch({ runs, jobs, total: 101 }) });
  assert.equal(result.runs, 3);
  assert.equal(result.successes, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.otherCompleted, 1);
  assert.equal(result.rerunCount, 1);
  assert.equal(result.medianMinutes, 10);
  assert.equal(result.jobs[0].queueMinutes, 2);
  assert.equal(result.truncated, true);
  assert.match(renderSummary({ generatedAt: now.toISOString(), results: [result] }), /50% \(1\/2\)/);
});

test('refuses private repositories before requesting runs', async () => {
  const report = await collectDashboard([config], { now, fetchImpl: fakeFetch({ isPrivate: true }) });
  assert.match(report.results[0].error, /not public/);
  assert.match(renderSummary(report), /Unavailable/);
});

test('reports API failures instead of claiming healthy data', async () => {
  const runs = [{ id: 1, run_attempt: 2, status: 'completed', conclusion: 'success', created_at: now.toISOString() }];
  const report = await collectDashboard([config], { now, fetchImpl: fakeFetch({ runs, failJobs: true }) });
  assert.match(report.results[0].error, /HTTP 503/);
  assert.match(renderHtml(report), /Unavailable/);
});

test('renders no runs explicitly and escapes untrusted job content', async () => {
  const empty = await collectRepository(config, { now, fetchImpl: fakeFetch() });
  assert.match(renderSummary({ generatedAt: now.toISOString(), results: [empty] }), /No runs in window/);
  const runs = [{ id: 1, run_attempt: 2, status: 'in_progress', created_at: now.toISOString(), html_url: 'javascript:alert(1)' }];
  const jobs = [{ name: '<script>alert(1)</script>', status: 'queued', labels: ['<img>'] }];
  const result = await collectRepository(config, { now, fetchImpl: fakeFetch({ runs, jobs }) });
  const html = renderHtml({ generatedAt: now.toISOString(), results: [result] });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.equal(result.jobs[0].queueMinutes, null);
});

test('alerts on latest failed runs and collection failures, not missing or pending runs', () => {
  const report = { results: [
    { repo: 'a', latest: { status: 'completed', conclusion: 'timed_out' } },
    { repo: 'b', error: 'HTTP 403' },
    { repo: 'c', latest: null },
    { repo: 'd', latest: { status: 'in_progress', conclusion: null } },
    { repo: 'e', latest: { status: 'completed', conclusion: 'cancelled' } },
  ] };
  assert.deepEqual(healthAlerts(report), ['a: latest default-branch CI timed_out', 'b: collection unavailable']);
});
