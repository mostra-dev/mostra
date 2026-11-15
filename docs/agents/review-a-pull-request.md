# Review a pull request before acceptance

Use when a work package's pull request is complete and green, before presenting it to Mirza (D80,
D172 item 0). Independent reviewers find what the author's own diff review misses: on WP-01 a
green gate suite still had 13 false negatives.

1. **Push everything** and let CI finish green, so the reviewers see the final diff.
2. **Choose the model review** (D172 item 0) and say why in the prompt you give Mirza:
   - **Claude Opus 5.5**, the default: thorough, and much cheaper. Most packages.
   - **Fable**, when the package lays down or changes architecture that checks can't prove: a new
     system, a foundational redesign, work whose correctness rests on the big picture. It reasons
     further and misses more details, and costs far more.
   - **Both**, when a package is very large and foundational.
3. **Write its prompt**: the package, its decisions, its evidence, the commit to review and where to
   look hardest. Give it to Mirza, who runs it or approves it (D34) and brings the findings back.
4. **Read Copilot's review.** The `main` ruleset requests a Copilot review on every push to a pull
   request. Its comments are review threads, and merging needs every thread resolved. If it reports
   a quota problem, note it in the progress report and continue.
5. **Triage every finding.** Each one is either fixed, with a regression test that fails on the old
   code where the finding is testable, or answered with the reason it doesn't hold. Never weaken a
   check to make a finding go away. Re-run the gates you touched.
6. **Record it** in the progress report: the reviewers, the models, the findings and their outcome.

Packages before WP-16 also ran GPT-6.1-Sol through `codex review`; from WP-16 on it is no longer
part of a package (D172 item 0).

**Done when** every finding from every reviewer is fixed or answered in the progress report, every
Copilot thread is resolved, and CI is green on the final head.
