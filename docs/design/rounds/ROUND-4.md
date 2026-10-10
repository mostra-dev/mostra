# Round 4: shell review and agent-facing prose

**Status:** Design input. Part A is a visual review. Part B agrees on the purpose, triggers, boundaries and structure of every piece of agent-facing prose before any full text is written ([STANDARDS.md](../STANDARDS.md#prose)). Full drafts follow once Mirza agrees on Part B, and are iterated with him until he accepts them.

## A. Shell prototype (SH-05)

Open `~/.jcode/scratch/proto-shell/index.html` in a browser. The dark strip at the bottom left switches states: version banner, comment mode, saving, submit then delivered, submit with the host offline, required answers missing, dark mode. Resize below 720 px for the phone layout. Screenshots are in [round4-shell/](round4-shell/).

Design direction: an exhibition frame (*mostra*). The shell recedes so the artifact is the work on the wall:
- **The rail.** A serif museum label (artifact title, version, family), quiet save state, a candidate switcher for review sets, the comment tool and the viewer chip.
- **The trusted zone,** at the right of the rail, is the only place the accent color (Venetian red) appears. A gilt hairline frames it and a small "Mostra · trusted control" seal marks it, so people learn what the real Submit looks like. On phones it becomes a bottom bar.
- **Comments.** Pins sit on an overlay above the artifact. Threads show their anchor and crop.
- **The version banner** sits under the rail and never covers content. It offers "Switch", "Always follow this artifact" (D63) and "Later", and says how many answers won't carry over (D42).
- **The submission receipt** keeps the facts separate: "Saved by Mostra" and "Delivered to Jcode", or "Pending delivery … Mostra will retry" (D47).

What I'd like judged:
- Does it stay out of the artifact's way?
- Is the trusted zone unmistakable without being loud?
- Does the phone layout work?
- Typography and color.
- Anything missing.

## B. Agent-facing prose: purpose, triggers, boundaries

| Item | Reader and moment | Purpose | Triggers (what makes the agent reach it) | Boundaries | Structure |
|---|---|---|---|---|---|
| **Agent Skill** `skills/mostra/SKILL.md`, model-invoked | Any coding agent deciding whether and how to use Mostra | Turn "the human should see or answer this" into a verified, published artifact and read the answer back | Four branches. (1) The work needs a human's input or decision: choose between candidates, answer questions, approve. (2) Results are better shown than told: report, dashboard, deck, demo. (3) A person needs a lasting page the agent keeps updated: dashboard, task list. (4) A terminal or web app must be demonstrated exactly | Not for chat-only answers or for building the project's own app. Never a reason to skip `verify` | Description: the four branches, front-loaded. Body (under ~5k tokens): the loop as steps with completion criteria (new → edit → `verify` until `pass` → `publish` → share the URL → `wait` → `results`); the vocabulary in one table; the five author APIs; the top diagnostic codes. Disclosed references: fields and submission, actions and secrets, live data and state, review sets, terminals, decks and motion, hosts, "write this, not that" |
| **Root `AGENTS.md`** (repository) | Contributor agents working on Mostra itself | How to work in this repository | Always loaded in the repository | Not a copy of the dossier; points into it | Commands (`pnpm check`, affected checks), the package map, invariants and their owners, the WP workflow, labels, D49 agreements, compaction requests, where each kind of doc lives |
| **Artifact `AGENTS.md`** (scaffolded by `mostra new`) | The agent editing one artifact | The local loop and conventions | Always loaded in the artifact directory | A few lines; everything else is behind pointers to the Skill and `mostra docs` | The loop, the field-ID rule, the files (`index.tsx`, `actions.ts`, `live.ts`), `mostra docs <topic>` |
| **MCP tool descriptions** (about 12) | Agents choosing a tool in chat or IDE hosts | One sentence each: what the tool does and when to call it | Front-loaded verb and object | Additive changes only (D32); hosts freeze snapshots | Verb, object, when, what comes back, one constraint |
| **CLI help** | Agents and people running `mostra <command> --help` | Usage, flags, examples, exit codes | `--help` | Generated from the command definitions, never hand-copied | Summary line, usage, flags, two examples, exit codes |
| **Diagnostic hints** | Agents reading a `verify` verdict | Tell the agent the fix | The verdict | One imperative sentence plus an optional machine-applicable fix and a docs link; never prose paragraphs | `message` states what is wrong; `hint` states what to do |

Leading words to reuse in every item, so they anchor the same behavior: **verify until pass**, **publish**, **capability URL**, **field ID**, **trusted control**, **results**.
