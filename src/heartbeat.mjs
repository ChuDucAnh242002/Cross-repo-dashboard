import { pathToFileURL } from 'node:url';
import { dashboardRepo, github, syncIncident } from './incidents.mjs';

export function heartbeatAlerts(runs, now = new Date()) {
  if (!Array.isArray(runs)) throw new Error('GitHub returned an invalid workflow run list.');
  const successful = runs.filter(run => run.event === 'schedule' &&
    run.status === 'completed' && run.conclusion === 'success');
  const times = successful.map(run => Date.parse(run.updated_at));
  if (times.some(time => !Number.isFinite(time) || time > now.getTime())) {
    throw new Error('GitHub returned an invalid or future completion time.');
  }
  const latest = Math.max(...times);
  return now.getTime() - latest > 3 * 60 * 60 * 1000
    ? ['No successful scheduled dashboard completion in the past 3 hours. ' +
       'Check scheduling, disabled workflows and collection failures; manual runs do not reset this heartbeat.']
    : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const now = new Date();
  const since = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const data = await github('GET', `/repos/${dashboardRepo}/actions/workflows/dashboard.yml/runs?` +
    new URLSearchParams({ event: 'schedule', per_page: '100', created: `>=${since}` }));
  const alerts = heartbeatAlerts(data.workflow_runs, now);
  await syncIncident('[CI health] Dashboard heartbeat missing', alerts);
  if (alerts.length) {
    console.error(alerts.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Scheduled dashboard heartbeat is fresh.');
  }
}
