# MT-04: the walkthrough run by Claude Sonnet from a clean Mostra home

Claude Code 2.1.325, `claude -p` with `--model sonnet` (claude-sonnet-5-5), no user settings, plugins, skills or MCP servers loaded; Mostra 0.15.1 through `npx -y @mostra/cli@0.15.1`; a scratch Mostra home, cache, config, runtime directory and npm cache; the Skill from this branch at `<run>/skill`. The person (Lena) and the second person (Priya) were played by the session in Chromium. 2026-11-16, 11:19 to 11:29 UTC. Every capability link secret is redacted.

## The request

Should I use Mostra? Show me what it can do.

Mostra's Agent Skill is installed for you at <run>/skill (start with its SKILL.md). Mostra isn't installed globally: run it as `npx -y @mostra/cli@0.15.1 <command>`. Work in the current directory.

About me: I run a three-person design studio. Every week I wait on clients to approve mockups, and on my partner Priya to sign off on our weekly plan. My email is me@studio.example and I'm Lena Fischer; Priya Shah is priya@studio.example. I'm at this computer, and Priya will answer from a private window on it. I can't reply to questions while you work, so make the reasonable choices yourself and tell me what you chose.

## What it did

- Model `claude-sonnet-5-5`, 24 built-in tools, 0 skills, 0 MCP servers.
- Read: `<run>/skill/SKILL.md`
- Read: `<run>/skill/references/walkthrough.md`
- Read: `<run>/skill/references/teams.md`
- Read: `<run>/skill/references/design.md`
- Read: `<run>/skill/references/long-lived.md`
- Read: `<run>/skill/references/server.md`
- Bash: `cd <run>/skill; grep -n -A40 -i "choosing between" references/answers.md | head -90; ls assets/examples/*`
- Bash: `cd <run>/work && npx -y @mostra/cli@0.15.1 new weekly-plan --title "Weekly plan: sign-off" 2>&1 | tail -15; ls -a weekly-plan; cat weekly-plan/index.tsx; cp ../skill/assets/studio.css weekly-plan/styl`
- Bash: `cd <run>/work/weekly-plan && mkdir -p notes && printf 'notes/\n' > .mostraignore`
- Said: Building the page passed verify; I'm fixing one contrast warning, then I'll look at the screenshots.
- Bash: `sed -i 's|<span className="text-muted-foreground">{o.hint}</span>|<span className="text-foreground">{o.hint}</span>|; s|<span className="text-muted-foreground">{f.hint}</span>|<span className="text-fo`
- Bash: `perl -pi -e 's|<span className="text-muted-foreground">\{([of])\.hint\}</span>|<span className="text-foreground">{$1.hint}</span>|' index.tsx && grep -c 'text-foreground">{' index.tsx; npx -y @mostra/`
- Read: `<run>/home/.mostra/cache/verify/368cacc5bba675d99ee5d2b43f3fe3e41dcade386783a52494065b5965821216/desktop.png`
- Read: `<run>/home/.mostra/cache/verify/368cacc5bba675d99ee5d2b43f3fe3e41dcade386783a52494065b5965821216/mobile.png`
- Said: Both screenshots look right. The empty number and the "0 of 0" are expected, because verify holds no pushes and no roster. Next I'll publish and set up the two links.
- Bash: `M="npx -y @mostra/cli@0.15.1" && $M publish . 2>&1 | grep -v "^verify:" ; $M push . awaiting --value '{"count":4,"oldestDays":5,"note":"Harbor Coffee, Fernweh Travel, Oakline Dental, Mara Ceramics"}' `
- Bash: `m(){ npx -y @mostra/cli@0.15.1 "$@" 2>&1 | grep -v "^verify:"; }; m publish . ; m push . awaiting --value '{"count":4,"oldestDays":5,"note":"Harbor Coffee, Fernweh Travel, Oakline Dental, Mara Ceramic`
- Bash: `n=5; for v in 5 6 7; do npx -y @mostra/cli@0.15.1 wait . --until submitted:all --timeout 2m 2>&1 | tail -2; rc=${PIPESTATUS[0]}; echo rc=$rc; [ $rc = 0 ] && break; npx -y @mostra/cli@0.15.1 push . awa`
- Bash: `npx -y @mostra/cli@0.15.1 results . --all 2>&1; ls notes`
- Said: Both of you answered. Your focus picks differ, so I'm writing that into "What happens next" and publishing a new version.
- Bash: `python3 - <<'EOF'`
- Said: **Should you use it?** For your weekly waiting game, I think yes. Here is what I built for you and Priya, and what it can and can't do. **What I built.** It's a "Weekly plan: sign-off" page, and you and Priya each had your own link. It had five parts: - **Live numbers:** four mockups were waiting on

## Its last message

**Should you use it?** For your weekly waiting game, I think yes. Here is what I built for you and Priya, and what it can and can't do.

**What I built.** It's a "Weekly plan: sign-off" page, and you and Priya each had your own link. It had five parts:
- **Live numbers:** four mockups were waiting on clients, and a chart showed mockups sent per day. I pushed the waiting count while we waited.
- **Questions:** each of you gave a sign-off, what went well, and what's blocked. It showed who was here and who had answered.
- **A choice:** next week's focus.
- **A real button:** it saves your answers as a Markdown note on this computer. It reached nobody else. It's in `notes/weekly-plan-lena-fischer.md`.
- **"What happens next":** I wrote this from your answers and published it as version 2. Open pages will offer it as an update.

**What came back:**
- **Priya:** approved the plan. She chose "Finish the Harbor Coffee mockups" and said Oakline's mockups went out early.
- **You (Lena):** approved with changes. You chose "Clear the client approvals" and said Fernweh signed off on round one. Your change was to move the studio site refresh to the week after.
- **Open question:** you and Priya picked different focuses. I suggested finishing Harbor Coffee first, then chasing the four waiting approvals on Thursday. That's only a suggestion, so you two decide.

**Choices I made without asking:**
- **Sample data:** all figures and client names (Harbor Coffee, Fernweh Travel, Oakline Dental, Mara Ceramics) are made up.
- **Save note:** I added a confirm step to the save button.
- **Priya's link:** it's local to this computer, so it works only in a private window.
- **Waiting rounds:** I didn't send any real messages. I only pushed count updates between waits.
- **Answers read:** I read answers for both people, since it was just the two of you.

**Where it would help you.** These are three replacements for message threads:
- **Mockup approvals:** a page per mockup, where the client picks an option and leaves feedback from their own link.
- **The weekly plan:** it can run every week (`epochs` policy).
- **A client dashboard:** it would show what's waiting on whom.

**Caveats:**
- **Local only:** links work on this computer only. Clients would need a hosted server or a temporary public tunnel (`mostra share --public`, which needs `cloudflared`), and I didn't set that up.
- **Background process:** it stops after 30 idle minutes.
- **Cost of a page:** each page takes a few minutes to build.

If you'd like one, I can build a client mockup-approval page next.

## Usage

19 turns, 615 s; tokens: 28 input, 44336 cache creation, 644699 cache read, 10736 output (Anthropic, Claude Code OAuth, approved by Mirza, D34).
