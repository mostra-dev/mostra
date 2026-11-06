# WP-29 recovery handoff, session 1

**Written:** 2026-11-05, during session 1, as a checkpoint while the package is still being built. Session 1 continues after it; a later session that finds this file resumes from **Next action**, after reading the specification, D165 and D166.

## Git state

- Branch `wp/29-remote-relay` (draft pull request #128), pushed; from `origin/main` `a6f974f`. Every slice of the specification is built and committed; `git log a6f974f..` lists them.
- The working tree is clean at each push. Logs of local runs are in `/Volumes/Active/wp29-logs/`; a full `pnpm check` runs in the detached worktree `/Volumes/Active/mostra-wp28-baseline`.

## Done, with evidence

The progress report's evidence table (`PROGRESS-WP-29.md`) is the record: RM-01, RM-04 and RM-07 verified, RM-02 validated (its external clause is WP-30's test deployment, D166 item 9), the four milestone issues fixed, D166 items 1 to 18 written, VERIFIED_FACTS' WP-29 section, the kit's remote scenarios, the Skill's sharing reference and changesets.

## Missing

1. **Prove:** the full `pnpm check` result recorded in the report; CI green on every leg (`ci:full` before the merge queue); the diff review; GPT-6.1-Sol's review through `codex review` (announced, D34) and Claude Opus 5.5's (Mirza runs it, D144), each finding fixed with a check red on the old code or answered.
2. **Prose for Mirza (D149), one batch:** the new commands' help (`login`, `logout`, `share --cloud`, `export`, `run`), the REMOTE diagnostics' hints, `MOSTRA_ARTIFACT_BUNDLE_INVALID`, the device page's words, the respondent's "Your answer was sent.", the Skill's additions (answers: counts by choice, approvals that do something; sharing: hosted on a server, actions on a hosted page, moving a version), the kit's scenario titles.
3. **Boundaries to state:** a bundle whose lockfile names on-demand packages a fresh home's store lacks (its install path is WP-08's and untested here); version files' sweep after a removal (removal is the operator's, WP-30); pause (WP-30); accounts and anonymous viewers (WP-30's sign-in); one Windows Firefox run timed out filling the hosted frame (trace saved in `/Volumes/Active/wp29-scratch/trace618`), passing on later runs.

## Next action

Record the full `pnpm check` and CI results, review the whole diff, run the GPT review, write the Claude Opus review prompt for Mirza, and present the candidate.
