# Review a pull request before acceptance

Use when a work package's pull request is complete and green, before presenting it to Mirza (D80).
Independent reviewers find what the author's own diff review misses: on WP-01 a green gate suite
still had 13 false negatives.

1. **Push everything** and let CI finish green, so the reviewers see the final diff.
2. **Announce the GPT review** to Mirza (D34): the question ("defects in WP-NN's pull request"),
   the model (GPT-6.1-Sol only, so it starts without waiting) and an estimate. A WP-01-sized diff
   (7,700 lines) took about 3.2 million input tokens, 95% of them cached, and 18,000 output tokens.
3. **Run the GPT-6.1-Sol review** from the repository root:
   ```sh
   codex review --base origin/main -c 'model="gpt-6.1-sol"' -c 'model_reasoning_effort="high"' \
     > "$JCODE_SCRATCH_DIR/review-wp-NN.md"
   ```
   It reads AGENTS.md, which leads to the dossier and your WP specification. In codex-cli 0.162,
   `--base` can't be combined with custom instructions. Record the provider, model, date and
   tokens Codex reports in the progress report.
4. **Read Copilot's review.** The `main` ruleset requests a Copilot review on every push to a pull
   request. Its comments are review threads, and merging needs every thread resolved. If it reports
   a quota problem, note it in the progress report and continue.
5. **Every package gets a Claude Opus 5.5 review too** (D144). Write its prompt (the package, its
   decisions, its evidence, the commit to review and where to look hardest) and give it to Mirza,
   who runs it (D34) and brings the findings back.
6. **Triage every finding.** Each one is either fixed, with a regression test that fails on the old
   code where the finding is testable, or answered with the reason it doesn't hold. Never weaken a
   check to make a finding go away. Re-run the gates you touched.
7. **Record it** in the progress report: reviewers, models, tokens, the findings and their outcome.

**Done when** every finding from every reviewer is fixed or answered in the progress report, every
Copilot thread is resolved, and CI is green on the final head.
