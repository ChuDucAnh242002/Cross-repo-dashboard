import { readFile } from 'node:fs/promises';
import { healthAlerts } from './dashboard.mjs';
import { dashboardRepo, github, syncIncident } from './incidents.mjs';

const exercise = process.argv.includes('--exercise');
const title = exercise ? '[Exercise] CI alert routing' : '[CI health] Default-branch failures';
const alerts = exercise
  ? ['Synthetic failure: notification exercise only; no project CI was changed.']
  : process.argv.includes('--report-unavailable')
  ? ['Dashboard report artifact is unavailable. Inspect the failed collection or artifact step.']
  : healthAlerts(JSON.parse(await readFile('dist/report.json', 'utf8')));
const numbers = await syncIncident(title, alerts);
if (exercise) {
  // Address the issue directly: GitHub's list endpoint may lag behind creation.
  for (const number of numbers) {
    await github('PATCH', `/repos/${dashboardRepo}/issues/${number}`, { state: 'closed' });
    console.log(`Closed exercise incident #${number}`);
  }
}
if (process.argv.includes('--report-unavailable')) process.exitCode = 1;
