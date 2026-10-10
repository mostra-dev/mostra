# C03-A decision tree

**Status:** Frontier empty as of 2026-10-10. Rounds 1 to 4 were answered (M6 to M8) and recorded as D34 to D69; design-time findings added D70 and D71. The default shadcn base waits only on EVAL-01. Retire this file at design acceptance. Original text follows.

Working document for the SP-58-C03-A phase design. It lists every open question, what it depends on, and the round in which it goes to Mirza. Settled answers move to [DECISIONS.md](DECISIONS.md) and this file only points to them. It is retired when the design is accepted.

**Sources of the open items:** every "Open for C03-A" item in [ARCHITECTURE.md](ARCHITECTURE.md), the extra items in the C03-A assignment (D33 confirmation, Windows, publication authorization, evaluation budget), and findings from [VERIFIED_FACTS.md](VERIFIED_FACTS.md).

**Kinds.** *Mirza* items are product choices, meaningful tradeoffs, permissions or changes to an approved decision. *Default* items have one clearly better answer; they are listed for veto in a round and recorded as design decisions unless Mirza objects.

## Round 1 (no open prerequisites)

| ID | Question | Source | Kind | Depends on |
|---|---|---|---|---|
| G1 | Confirm D33 and set the evaluation budget and providers | D33, assignment | Mirza | none |
| G2 | Windows support in v1 | PRODUCT, RT-07 | Mirza | none |
| G3 | Standing publication authorization for accepted work packages | STANDARDS | Mirza | none |
| G4 | Account setup timing (GitHub org, npm org, domain) | D13, D15 | Mirza | none |
| AD1 | Frame credential and default addressing (changes D06 item 4 or D21) | §10, §11, prototype | Mirza | none |
| IN1 | Draft scope | §7 | Mirza | none |
| IN2 | Artifact-rendered submit in the standalone host | §7, §10 | Mirza | none |
| VR1 | Does publish run verify, and what blocks it | §3 | Mirza | none |
| VR2 | Version switch when fields can't be mapped | §3 | Mirza | none |
| DP1 | Auto-install unknown imports or require `mostra add` | §6 | Mirza | none |
| AC1 | Secrets handling | §8 | Mirza | none |
| PM1 | Instance model | §4 | Mirza | none |
| HO1 | Optional AI port in v1 | §12 | Mirza | none |
| R1-D | Defaults listed in round 1 for veto: retention and GC, event compaction, action-run retention, outbox states, comment threading, tunnel driving and the SSE fallback, interop plugins, import-map mode, tooling deviations | §3, §7, §8, §9, §11, §16, STANDARDS | Default | none |

## Round 2 (caller-first interfaces; needs round 1)

| ID | Question | Depends on |
|---|---|---|
| AU1 | Manifest form | IN1 |
| AU2 | Field identity rules | IN1, VR2 |
| AU3 | Multi-page routing | AD1 |
| CR1 | Client runtime API, two candidates (`useField` family vs one draft store) | IN1, IN2, AU2 |
| CR2 | `window.storage` compatibility shim | IN1, CR1 |
| SF1 | Server function and action API, serialization type set, `"use server"` only | AC1 |
| SF2 | Dry-run semantics for actions in `verify` | SF1, VR1 |
| LD1 | Live data API (`useLive`, loaders, push) | CR1 |
| HP1 | Host protocol and port shapes, two candidates | PM1, AD1, IN1 |
| HP2 | Schema source of truth and protocol versioning | HP1 |
| HP3 | Mandatory and optional ports; transports | HP1, PM1 |
| CL1 | CLI command set and names | PM1, VR1, DP1 |
| MC1 | MCP tool list and schemas | CL1 |
| MC2 | How exported MCP Apps reach durable storage | HP1, MC1 |
| RS1 | `share` commands and tunnel hostname registration | AD1 |
| PM2 | Mostra home layout, idle eviction, restart policy, resource limits | PM1 |

## Round 3 (kit, terminal, extensions, packages; needs round 2 and prototypes)

| ID | Question | Depends on |
|---|---|---|
| KT1 | Default shadcn base (evaluation) | G1, base-evaluation prototype |
| KT2 | Final kit list, warm set, maps and 3D on demand | DP1, KT1 |
| KT3 | Questionnaire and form component API | CR1, KT1 |
| KT4 | Composition primitive API | CR1 |
| KT5 | Deck grammar | CR1, AU1 |
| TM1 | PTY implementation and host PTY port | PM1, HP1 |
| TM2 | Headless emulator (avt vs `@xterm/headless`) | terminal fixture prototype |
| TM3 | Terminal frame schema | TM2 |
| EX1 | v1 extension contract list, versions and manifest schema | HP1, SF1 |
| EX2 | Pack format; how kit packages stay in step with the warm set | KT2 |
| EX3 | Plugin loading order and conflict rules; first-party plugin list | EX1 |
| RD1 | `RenderMode` contract methods | SF1, EX1 |
| RV1 | Bridge injection into proxied foreign apps; review export format | AD1, HP1 |
| SH1 | Shell bridge message set; host-replaceable shell chrome | HP1, CR1 |
| VF1 | Diagnostics catalog, smoke-test scope, regression baselines, viewports, warm browser | SF2, CL1 |
| VF2 | Harness plugin packaging | CL1, MC1 |
| MC3 | Per-host MCP Apps conformance (Claude, ChatGPT, VS Code) | MC2 |
| PK1 | Package map, two candidates | all of the above |

## Round 4 (review and prose)

| ID | Question | Depends on |
|---|---|---|
| SH2 | Shell visual design (prototype for Mirza's review) | SH1 |
| PR1 | Agent Skill and AGENTS.md, drafted jointly | CL1, CR1, SF1 |
| PR2 | MCP tool descriptions, CLI help, diagnostic hint style | MC1, CL1, VF1 |
| WP1 | Work-package sequence | everything |
