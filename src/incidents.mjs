import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const dashboardRepo = 'ChuDucAnh242002/Cross-repo-dashboard';
const marker = '<!-- platform-health-incident:v1 -->';

export async function github(method, path, fields = {}) {
  const args = ['api', '--method', method, path];
  for (const [key, value] of Object.entries(fields)) args.push('--raw-field', `${key}=${value}`);
  const { stdout } = await execute('gh', args, { timeout: 30000, maxBuffer: 1048576 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

export async function syncIncident(title, alerts, { request = github } = {}) {
  const issues = [];
  for (let page = 1; ; page++) {
    const batch = await request('GET', `/repos/${dashboardRepo}/issues?state=open&per_page=100&page=${page}`);
    issues.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) throw new Error('Too many open issues to deduplicate incidents safely.');
  }
  const existing = issues.filter(issue => !issue.pull_request && issue.title === title &&
    issue.body?.startsWith(marker) &&
    ['github-actions[bot]', 'ChuDucAnh242002'].includes(issue.user?.login));
  const numbers = existing.map(issue => issue.number);
  const body = `${marker}\n## ${title}\n\n${alerts.map(alert => `- ${alert}`).join('\n')}\n\n` +
    'Inspect the [dashboard workflow](https://github.com/' + dashboardRepo +
    '/actions/workflows/dashboard.yml). This issue is updated only when the condition changes ' +
    'and automatically closed after recovery. GitHub notification delivery depends on your subscription settings.';
  if (alerts.length && !existing.length) {
    const issue = await request('POST', `/repos/${dashboardRepo}/issues`, { title, body });
    numbers.push(issue.number);
    console.log(`Opened incident: ${issue.html_url}`);
  }
  for (const issue of existing) {
    if (alerts.length && issue.body === body) continue;
    await request('PATCH', `/repos/${dashboardRepo}/issues/${issue.number}`,
      alerts.length ? { body } : { body: `${marker}\nRecovered. The next check observed a healthy condition.`, state: 'closed' });
    console.log(`${alerts.length ? 'Updated' : 'Closed'} incident #${issue.number}`);
  }
  return numbers;
}
