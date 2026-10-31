# Check the harness plugins

Use when a change touches the harness plugin (`tools/plugins/`), turns on one of its features
(`features.localMcp` in WP-15, `features.remoteMcp` in WP-30), changes the Skill's frontmatter or
layout, or before a plugin is submitted to a directory. CI's `docs` job builds the plugin and
runs `node tools/plugins/cli.ts check` on every such change; this playbook adds what CI can't:
each harness's own CLI loading it (D162).

1. **Install the harness CLIs** you don't have, outside the repository (D49; the external `Active`
   disk when the system disk is tight): `npm install @google/gemini-cli @github/copilot skills`
   into a scratch directory, and `uv` for skills-ref. Claude Code and Codex are usually installed.
   Record each version you use.
2. **Run** `tools/plugins/try-harnesses.sh <empty scratch dir>`, with
   `MOSTRA_HARNESS_BIN=<scratch>/node_modules/.bin` when the CLIs aren't on `PATH`. It builds the
   plugin, runs the check, and loads it in Claude Code (`claude plugin validate --strict`, then an
   install in a scratch `CLAUDE_CONFIG_DIR`), Codex (a scratch `CODEX_HOME`), Gemini CLI, Copilot
   CLI (scratch homes), the `skills` CLI and skills-ref. Each line says what the harness found.
3. **With a server feature on**, also start the server the plugin declares from each harness that
   ran (Claude Code's `/mcp`, Codex's `codex mcp list`, Gemini's `/mcp`), and check that it sends
   nothing (D148: `MOSTRA_TELEMETRY_DEBUG=1` prints any event it would send). Do it on macOS,
   Linux and native Windows (a GitHub `windows-latest` runner, `docs/agents/run-on-windows.md`):
   on Windows `npx` is `npx.cmd`, which a harness that starts servers without a shell can't run.
   Where one can't, change that harness's launch in `tools/plugins/build.ts` and prove it again on
   all three: every system reads the same manifest, so a `cmd /c npx …` launch would break macOS
   and Linux; use the harness's own per-system setting where it has one. List each system the
   launch started on in `features.localMcp.verifiedOn`; the check keeps the feature off until all
   three are there.
4. **Cursor and Muse Code** need what the script can't give them: Cursor's agent CLI manages
   marketplaces only after sign-in (copy the built plugin to `~/.cursor/plugins/local/mostra` and
   reload Cursor instead), and Muse Code's plugins are a developer preview (`muse plugins
   validate`). Check them when an account is at hand, and say so when not.
5. **Re-verify the directories' rules** before a submission, against their own pages on the day
   (D147): Anthropic's pre-submission checklist, OpenAI's submission and desktop-only pages, Grok
   Build's `CONTRIBUTING.md`. A rule that changed goes into `tools/plugins/check.ts` with a seed in
   `tools/test/plugins.test.ts`, and into `docs/design/VERIFIED_FACTS.md`. Submitting is Mirza's.

**Done when** the script reports every installed harness `✓` and none `✗`, the harnesses it
skipped are named in your report with the reason, and any rule that changed is in the check.
