# Cross-repository CI dashboard

This dashboard reports public GitHub Actions CI health for the seven projects
listed in [`src/dashboard.mjs`](src/dashboard.mjs). It uses the GitHub API,
not workflow logs or application data. Collection refuses repositories that
are private, so do not use it to publish private repository metadata.

## View the dashboard

After this workflow is merged into `main`:

1. Open **Actions → CI health dashboard** in this repository.
2. Select a completed run to see its summary table.
3. Download the **ci-health-dashboard** artifact, extract it, and open
   `index.html` in a browser. `report.json` contains the same snapshot data.

The workflow runs hourly, on pushes to `main`, and on pull requests. You can
also select **Run workflow** from the Actions page. Scheduled and manual
workflow dispatches use the workflow on the default branch, so they become
available after merging. Artifacts expire after seven days.

## Run locally

Requires Node.js 22 or newer and access to the GitHub API:

```sh
node --test
node src/report.mjs
```

Open `dist/index.html`. Requests are anonymous unless `GITHUB_TOKEN` is set;
unauthenticated GitHub API rate limits may prevent collection. The workflow
uses its repository-scoped read-only token; no personal token is required.
`dist/` is generated and is not committed.

## How to interpret it

- Each project is tracked by its CI workflow file and current default branch.
  The report considers only **push** runs from the past 30 days, up to 100 per
  workflow. A `+` means more runs exist than the report fetched.
- Pass rate counts successes against successes plus failures, timeouts, and
  startup failures. Cancelled, skipped, neutral, and other outcomes are
  excluded. Reruns count runs with more than one attempt; they do not prove a
  test is flaky.
- Median duration uses GitHub's run-start and update timestamps for completed
  runs. The latest run's job wait estimate uses job creation to job start and
  can include dependency scheduling, not just runner queue time.
- **No runs** means no matching recent default-branch push runs, not a healthy
  or unhealthy result. **Unavailable** means collection failed or the
  repository is private; the report job fails instead of treating missing data
  as success. Job details are limited to the latest attempt and first 100 jobs.

On scheduled runs, the workflow fails if a repository cannot be collected or
its latest default-branch CI run failed, timed out, or failed to start. GitHub
notifications depend on your notification settings; this is not immediate
alerting, and repeated scheduled failures may produce repeated notifications.
Pull-request and manual runs do not fail solely because a project's CI is red.
No runs, pending runs, and cancelled runs do not count as successful checks.

GitHub Actions schedules can be delayed; detecting a missing scheduled run
requires an independent heartbeat monitor. This dashboard does not collect
Jenkins or self-hosted runner machine health.