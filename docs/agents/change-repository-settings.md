# Change a GitHub repository setting

Use when the repository's GitHub configuration needs to change: merge options, security features,
Actions permissions, or the rulesets protecting `main` and release tags. Settings are code, so
every change is reviewed like any other.

1. **Edit the desired state.** Repository fields, security features and Actions permissions are in
   `tools/github/settings.ts`; rulesets are the JSON files in `.github/rulesets/` (GitHub's
   ruleset API format). D76 and D79 say what the repository must enforce; loosening any of it is
   Mirza's decision.
2. **Apply it** with an admin `gh` session: `node tools/github/settings.ts apply`. The command
   creates or updates the rulesets by name and then verifies the live repository.
3. **Prove it** when a rule changes: attempt the action the rule forbids (for example a direct
   push to `main`) and record the rejection in the progress report.

**Done when** `node tools/github/settings.ts verify` prints that the live settings match, and the
change is committed in the same pull request.
