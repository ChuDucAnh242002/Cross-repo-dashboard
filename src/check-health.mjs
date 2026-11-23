import { readFile } from 'node:fs/promises';
import { healthAlerts } from './dashboard.mjs';

const report = JSON.parse(await readFile('dist/report.json', 'utf8'));
const alerts = healthAlerts(report);
if (alerts.length) {
  for (const alert of alerts) console.error(alert);
  process.exitCode = 1;
} else {
  console.log('No completed default-branch CI failures detected.');
}
