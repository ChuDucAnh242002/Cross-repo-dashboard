import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { collectDashboard, renderHtml, renderSummary } from './dashboard.mjs';

const report = await collectDashboard(undefined, { token: process.env.GITHUB_TOKEN });
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', renderHtml(report));
await writeFile('dist/report.json', JSON.stringify(report, null, 2) + '\n');
const summary = renderSummary(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
if (report.results.some(result => result.error)) {
  console.error('One or more repositories could not be collected; see the report.');
  process.exitCode = 1;
}
