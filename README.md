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

## Incident issues and independent heartbeat

Scheduled runs open one **[CI health] Default-branch failures** issue, update it
only when the failures change, and close it after recovery. Subscribe to this
repository's issues to receive GitHub notifications. This verifies publication,
not email or push delivery. Manual runs retain their reporting-only behavior
unless **exercise_alert** is checked; that option opens and closes a clearly
labelled synthetic issue without changing any project's CI.

The user-level systemd timer checks every 15 minutes whether a successful
**scheduled** report completed within three hours. Manual runs cannot hide a
broken schedule. A stale heartbeat opens a separate issue and exits nonzero;
API/authentication errors fail visibly in the journal instead of reporting
health. If GitHub itself is unreachable it cannot deliver a GitHub issue.

Install on an always-on Linux machine with Node.js 22+, `gh`, an authenticated
GitHub account with issue-write access, and a working user systemd session:

```sh
node --test
install -d ~/.local/share/cross-repo-heartbeat ~/.config/systemd/user
install -m 644 src/heartbeat.mjs src/incidents.mjs ~/.local/share/cross-repo-heartbeat/
install -m 644 systemd/cross-repo-heartbeat.{service,timer} ~/.config/systemd/user/
# systemd does not inherit your interactive shell's Node.js path.
mkdir -p ~/.config/systemd/user/cross-repo-heartbeat.service.d
printf '[Service]\nEnvironment="PATH=%s"\n' "$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin" \
  > ~/.config/systemd/user/cross-repo-heartbeat.service.d/path.conf
systemctl --user daemon-reload
systemctl --user enable --now cross-repo-heartbeat.timer
systemctl --user start cross-repo-heartbeat.service
systemctl --user list-timers cross-repo-heartbeat.timer
journalctl --user -u cross-repo-heartbeat.service -n 30 --no-pager
```

No token is copied into the unit: `gh` uses the account's existing credentials.
The timer is independent of Actions but **not** of this machine: sleep, shutdown,
logout without lingering, or expired credentials interrupt checks. Use an
always-on host for dependable monitoring; lingering is not enabled automatically.
Reinstall the two scripts after updates. Uninstall with
`systemctl --user disable --now cross-repo-heartbeat.timer`, then remove the
named unit files, drop-in and installed scripts and reload the user daemon.