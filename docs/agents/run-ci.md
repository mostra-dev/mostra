# Run CI and read it

Use when a pull request needs CI, a Renovate update should be checked, a pull request merges, or
CI got slower or failed in a way you don't understand. The design is D152; REPO_STANDARDS §6
lists the jobs.

## What runs when

| Event | What runs |
|---|---|
| A pull request opened, pushed to, reopened or marked ready | The jobs the change affects (`pnpm check --plan --affected`), on Linux, macOS (at most five legs: GitHub runs five macOS jobs at once) and Windows x64; the release rehearsal on linux-x64 when a package changed, on all four platforms when anything a bundle or a release reads changed |
| The `ci:full` label on a pull request | Everything, on every leg, as the merge queue runs it (takes effect on the next push or re-run) |
| A bot's draft pull request (Renovate) | Nothing, until it is ready for review |
| The merge queue | The affected jobs on every leg: Windows arm64 and the four-platform rehearsal join; this run gates the merge |
| Nightly on `main` (03:23 UTC) | Everything, unless the last nightly run passed on the same commit |
| By hand (`gh workflow run ci.yml`) | Everything (`-f full=false` for the jobs the branch affects) |
| A push to `main` | No `CI`: what merged already passed the queue. `Release` decides whether a version is due, CodeQL and Scorecard run |

The plan job's summary shows the scope, the runners chosen and every leg.

## Common tasks

1. **Check a Renovate update.** Read its pull request (the notes, the advisory, the release's age),
   then `gh pr ready <number>`: CI runs from that moment. Follow `update-dependency.md` for what to
   check. Security updates are drafts too: mark them ready the day they open.
2. **Run everything on a pull request.** `gh pr edit <number> --add-label ci:full`, then push or
   `gh run rerun <run id>`. Remove the label when the change no longer needs it.
3. **Merge.** When `ci-ok` is green and every review thread is resolved:
   `gh pr merge <number> --merge`. The pull request joins the merge queue, which runs `CI` on the
   pull request merged with `main` (and with whatever is ahead of it in the queue) and merges it
   when that run's `ci-ok` passes. A failure there takes it out of the queue; fix it and add it
   again. The queue brings the pull request up to date with `main`, so its branch stays as it is.
4. **Choose where Linux jobs run.** The repository variable `CI_RUNNERS` is `auto` (default),
   `github` or `blacksmith`: `gh variable set CI_RUNNERS --body github`. Under `auto`, Linux jobs
   run on Blacksmith while its usage over the last 31 days is below `BLACKSMITH_THRESHOLD` (0.9)
   of `BLACKSMITH_BUDGET` (6000 billing minutes: its free 3,000 2-vCPU minutes, each 2 billing minutes), and on GitHub's runners
   otherwise, also whenever Blacksmith's status page isn't up, its usage can't be read or the run
   has no secrets (a fork). `blacksmith` overrides the budget and an unreadable usage or status
   page, never a fork or an outage the status page reports. Publishing, bundle builds and
   smoke tests always use GitHub's runners (npm trusted publishing needs them). macOS and Windows
   always run on GitHub's.
   A fork's pull request runs its own copy of these workflows, so the fallback binds only runs from
   this repository's branches. An outside contributor's run starts only once it is approved: read
   its changes to `.github/` and `tools/check/` before approving it, or adding it to the merge
   queue, whose run has the repository's secrets.
5. **See Blacksmith's usage.** `blacksmith usage --since 30d --breakdown-by runner_type,workflow`
   (the CLI signed in with `blacksmith auth login`), or the plan job's summary.
6. **Find what made a run slow.** Per job, `gh api repos/mostra-dev/mostra/actions/runs/<id>/jobs`
   gives `created_at`, `started_at` and `completed_at`: the gap between the first two is the queue.
   GitHub's free plan runs 20 jobs at once and at most 5 macOS jobs; Blacksmith's jobs don't count
   against either.
7. **A failed integration leg.** Download its `logs-integration-*` artifact: each test home's
   supervisor log. A failure that a re-run cures is a finding: file it with the run and job IDs,
   or add the occurrence to its issue.
8. **Add a job or a leg.** The job goes in `tools/check/jobs.ts` (so `pnpm check` runs it), its legs
   in `tools/check/matrix.ts`, its CI job in `.github/workflows/ci.yml` (and in `ci-ok`'s `needs`),
   and a case in `tools/test/ci.test.ts`.

**Done when** the pull request's `ci-ok` is green on its latest push, its merge-queue run passed
and it merged, or the failure you were reading is fixed or filed.
