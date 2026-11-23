export const repositories = [
  { repo: 'ChuDucAnh242002/di-agent', workflow: 'ci.yml' },
  { repo: 'ChuDucAnh242002/Life-Pension-workspace', workflow: 'ci.yaml' },
  { repo: 'ChuDucAnh242002/SME-Cash-Flow-Copilot', workflow: 'ci.yaml' },
  { repo: 'ChuDucAnh242002/vibe', workflow: 'tests.yml' },
  { repo: 'ChuDucAnh242002/Flight_Weather_Intergration', workflow: 'ci.yml' },
  { repo: 'bcsani/Loneliness-App', workflow: 'ci.yml' },
  { repo: 'ChuDucAnh242002/advance-backend', workflow: 'ci.yml' },
];

const API = 'https://api.github.com';
const failureConclusions = new Set(['failure', 'timed_out', 'startup_failure']);

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesBetween(start, end) {
  const from = timestamp(start);
  const to = timestamp(end);
  return from === null || to === null || to < from ? null : (to - from) / 60000;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null;
  } catch {
    return null;
  }
}

export async function collectRepository(config, { fetchImpl = fetch, token, now = new Date() } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function get(path) {
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error('GitHub API request failed or timed out');
    }
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub API returned invalid JSON');
    }
  }

  const repo = await get(`/repos/${config.repo}`);
  if (repo.private !== false) throw new Error('Repository is not public; collection refused');
  if (typeof repo.default_branch !== 'string' || !repo.default_branch) {
    throw new Error('GitHub API did not return a default branch');
  }

  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    branch: repo.default_branch,
    event: 'push',
    created: `>=${cutoff.slice(0, 10)}`,
    per_page: '100',
  });
  const data = await get(`/repos/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${query}`);
  if (!Array.isArray(data.workflow_runs) || !Number.isInteger(data.total_count)) {
    throw new Error('GitHub API returned an invalid workflow run list');
  }
  if (data.workflow_runs.some(run => timestamp(run.created_at) === null)) {
    throw new Error('GitHub API returned a run without a valid creation time');
  }
  const runs = data.workflow_runs.filter(run => timestamp(run.created_at) >= timestamp(cutoff));
  const completed = runs.filter(run => run.status === 'completed');
  const successful = completed.filter(run => run.conclusion === 'success');
  const failed = completed.filter(run => failureConclusions.has(run.conclusion));
  const durations = completed.map(run => minutesBetween(run.run_started_at, run.updated_at))
    .filter(value => value !== null);
  const latest = runs[0];
  let jobs = [];
  let jobsTruncated = false;
  if (latest) {
    const attempt = Number.isInteger(latest.run_attempt) && latest.run_attempt > 0
      ? latest.run_attempt : 1;
    const result = await get(`/repos/${config.repo}/actions/runs/${latest.id}/attempts/${attempt}/jobs?per_page=100`);
    if (!Array.isArray(result.jobs) || !Number.isInteger(result.total_count)) {
      throw new Error('GitHub API returned an invalid job list');
    }
    jobs = result.jobs.map(job => ({
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      runner: job.runner_name,
      labels: Array.isArray(job.labels) ? job.labels : [],
      queueMinutes: minutesBetween(job.created_at, job.started_at),
      url: safeUrl(job.html_url),
    }));
    jobsTruncated = result.total_count > jobs.length;
  }
  return {
    repo: config.repo,
    workflow: config.workflow,
    branch: repo.default_branch,
    latest: latest ? {
      status: latest.status,
      conclusion: latest.conclusion,
      createdAt: latest.created_at,
      attempt: latest.run_attempt,
      url: safeUrl(latest.html_url),
    } : null,
    runs: runs.length,
    successes: successful.length,
    failures: failed.length,
    otherCompleted: completed.length - successful.length - failed.length,
    rerunCount: runs.filter(run => run.run_attempt > 1).length,
    medianMinutes: median(durations),
    truncated: data.total_count > data.workflow_runs.length,
    jobs,
    jobsTruncated,
  };
}

export async function collectDashboard(configs = repositories, options = {}) {
  const now = options.now ?? new Date();
  const results = [];
  for (const config of configs) {
    try {
      results.push(await collectRepository(config, { ...options, now }));
    } catch (error) {
      results.push({
        repo: config.repo,
        workflow: config.workflow,
        error: error instanceof Error ? error.message : 'Unknown collection error',
      });
    }
  }
  return { generatedAt: now.toISOString(), results };
}

export function healthAlerts(report) {
  return report.results.flatMap(result => {
    if (result.error) return [`${result.repo}: collection unavailable`];
    if (result.latest?.status === 'completed' && failureConclusions.has(result.latest.conclusion)) {
      return [`${result.repo}: latest default-branch CI ${result.latest.conclusion}`];
    }
    return [];
  });
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeMarkdown(value) {
  return escapeHtml(value).replaceAll('|', '&#124;').replaceAll('\n', ' ').replaceAll('\r', ' ');
}

function status(latest) {
  if (!latest) return 'No runs in window';
  return latest.status === 'completed' ? latest.conclusion || 'unknown' : latest.status || 'unknown';
}

function passRate(result) {
  const total = result.successes + result.failures;
  return total ? `${Math.round(result.successes / total * 100)}% (${result.successes}/${total})` : '—';
}

function minutes(value) {
  return value === null ? '—' : `${value.toFixed(1)} min`;
}

export function renderSummary(report) {
  const rows = report.results.map(result => {
    const name = escapeMarkdown(result.repo);
    if (result.error) return `| ${name} | Unavailable: ${escapeMarkdown(result.error)} | — | — | — |`;
    const state = escapeMarkdown(status(result.latest));
    const latest = result.latest?.url ? `[${state}](${result.latest.url})` : state;
    return `| ${name} | ${latest} | ${passRate(result)} | ${minutes(result.medianMinutes)} | ${result.runs}${result.truncated ? '+' : ''} |`;
  });
  return [
    '## Cross-repository CI health',
    '',
    `Generated: ${report.generatedAt} UTC. Default-branch push runs, last 30 days; at most 100 per workflow.`,
    '',
    '| Repository | Latest run | Pass rate | Median duration | Runs |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Pass rate includes successful runs and failures/timeouts/startup failures; other conclusions are excluded. Download the dashboard artifact for runner and job details.',
    '',
  ].join('\n');
}

export function renderHtml(report) {
  const cards = report.results.map(result => {
    const title = escapeHtml(result.repo);
    if (result.error) {
      return `<section class="card"><h2>${title}</h2><p class="bad">Unavailable: ${escapeHtml(result.error)}</p></section>`;
    }
    const state = status(result.latest);
    const stateClass = state === 'success' ? 'good' : failureConclusions.has(state) ? 'bad' : 'unknown';
    const link = result.latest?.url
      ? `<a href="${escapeHtml(result.latest.url)}">${escapeHtml(state)}</a>` : escapeHtml(state);
    const jobRows = result.jobs.map(job => `<tr><td>${job.url ? `<a href="${escapeHtml(job.url)}">${escapeHtml(job.name)}</a>` : escapeHtml(job.name)}</td><td>${escapeHtml(job.status === 'completed' ? job.conclusion || 'unknown' : job.status)}</td><td>${escapeHtml(job.runner || 'Not assigned')}<br><small>${escapeHtml(job.labels.join(', '))}</small></td><td>${minutes(job.queueMinutes)}</td></tr>`).join('');
    return `<section class="card"><h2>${title}</h2>
      <p class="${stateClass}">${link}</p>
      <p>Default branch: ${escapeHtml(result.branch)} · Workflow: ${escapeHtml(result.workflow)}</p>
      <div class="metrics"><span>Pass rate<strong>${passRate(result)}</strong></span><span>Median duration<strong>${minutes(result.medianMinutes)}</strong></span><span>Runs<strong>${result.runs}${result.truncated ? '+' : ''}</strong></span><span>Runs rerun<strong>${result.rerunCount}</strong></span></div>
      <p>Latest run created: ${escapeHtml(result.latest?.createdAt || '—')} · Other completed outcomes: ${result.otherCompleted}</p>
      <details><summary>Latest run jobs and runners (${result.jobs.length}${result.jobsTruncated ? '+' : ''})</summary>
      ${jobRows ? `<div class="table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Runner / labels</th><th>Wait estimate</th></tr></thead><tbody>${jobRows}</tbody></table></div>` : '<p>No job data available.</p>'}
      </details></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CI health dashboard</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;background:#f3f5f8;color:#182132;margin:0}
main{max-width:1100px;margin:auto;padding:2rem 1rem}h1{margin-bottom:.2rem}h2{font-size:1.05rem;overflow-wrap:anywhere}
a{color:#174caa}p{margin:.5rem 0}.intro{color:#515e70}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:1rem}
.card{background:white;border:1px solid #dce2eb;border-radius:10px;padding:1rem}.good{color:#16713e;font-weight:700}.bad{color:#b42318;font-weight:700}.unknown{color:#795600;font-weight:700}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin:1rem 0}.metrics span,small{color:#515e70;font-size:.8rem}.metrics strong{display:block;color:#182132;font-size:1rem}
summary{cursor:pointer;font-weight:600}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.85rem}td,th{text-align:left;padding:.4rem;border-bottom:1px solid #e6eaf0}
@media(max-width:500px){.metrics{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main>
<h1>CI health dashboard</h1><p class="intro">Generated ${escapeHtml(report.generatedAt)} · Default-branch push runs from the last 30 days, capped at 100 per workflow.</p>
<p class="intro">Pass rate includes successes and failures/timeouts/startup failures; other outcomes are excluded. Wait estimates run from job creation to start and may include dependency scheduling, not just runner queueing. Durations use GitHub's run start and update times. No runs or missing data are not healthy signals.</p>
<div class="grid">${cards}</div></main></body></html>`;
}
