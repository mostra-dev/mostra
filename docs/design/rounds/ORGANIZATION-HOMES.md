# Homes an organization owns: the design (D170)

**Status:** Approved design, recorded as D170 (M65). It was written on 2026-11-12 by a design session under MT-03, which Mirza had asked for a design of organization-owned homes (D169 item 9) and to which he delegated every open question; the session decided each, and Mirza had the result recorded. This file keeps the whole design: the candidates weighed for every shape, what each winner borrowed, the grounding in the code as of `dcd6930`, the journeys and the checks. The dossier carries the decided surface: D170, PRODUCT's vocabulary and J15, ARCHITECTURE §15, INTERFACES §18.10, DATA_MODEL §7.6, FAILURE_MODEL §11.5 and REQUIREMENTS' RM-10 to RM-14, HO-12, HY-10 and MC-05. WP-33 to WP-35 build it. Where this file and the dossier differ, the dossier wins (STANDARDS' order of sources). It supersedes MT-03's first sketch, [MT-03-ORGANIZATION-HOMES.md](MT-03-ORGANIZATION-HOMES.md).

**How to read it.** Section 1 is the whole design on one page. Section 9 is each decision and the reason that settled it. The rest is the evidence and the shapes.

**What I read, and what I did not.** Read whole: AGENTS.md, the dossier README, PRODUCT, ARCHITECTURE §1 and §15, INTERFACES §18, DATA_MODEL §7, FAILURE_MODEL §11, STANDARDS (Design, Failure handling), WORK_PACKAGES, the MT-03 sketch, PROGRESS-MT-03, and the code named in section 2. Read in part: DECISIONS (D04 to D06, D97, D98, D104, D105, D116 to D128, D144, D145, D159 to D161, D165 to D169 in full; the other entries by heading only), `tools/design/wp_specs.py` (the generator and the MT-03, WP-16, WP-31 and WP-W entries), REQUIREMENTS (the row format and the RM, HO, HY, CO and MC rows), PROGRESS-WP-29 to WP-31 (their boundaries and follow-ups by search), `server/relay.ts` and `server/authorize.ts` (by function, not line by line). I did not read REPO_STANDARDS §3 beyond what AGENTS.md says of it. Claims about code I did not read line by line are labelled *hypothesis*. Two hypotheses of the first draft were checked against the code for this version and are now stated as facts (section 2, findings 2 and 4).

---

## 1. Summary

### The design

1. **An organization is an account of a new kind, and it owns one hosted home.** `account.kind` gains `organization`. The home's owner is still one account, so every tenancy rule, every route and every port query keeps its meaning. A person keeps their own home and can belong to any number of organizations.

2. **The server keeps each organization home's member list, and only the operator writes it.** A new table, `home_member(home_id, account_id, role)`, lives in the server's directory. The operator module sets it through the server handle (`setOrganization`, `setMembers`, `setMember`, `removeMember`). Every check is local to the server, so an operator outage never disconnects a team. The open server ships no way to administer organizations: with no operator module there are none, and the product is exactly today's.

3. **Every session acts on one home, named by its grant.** A grant gains `home_id`. A person's sign-in for a machine (`mostra login <server> --org acme`) or for a chat host names the home on the server's own page, and the token then acts there and nowhere else. An instance holds one link per server and home, each its own revocable grant, its own `lnk_` ID and its own connection.

4. **Two roles and three rights.** Roles: `member` and `admin`. Rights: every member *reads* every artifact of the home (list, results, wait, events, state). The member whose instance owns an artifact, and every admin, *manage* it (links, roster, pause, state writes). Only the artifact's owner instance *runs* it (pushes versions, receives deliveries, runs relayed code). An artifact shared as `private` is read only by its owner member and admins. Finer rules are the operator's, through `limits` with the acting member named.

5. **One owner instance per artifact stays the rule.** Code and secrets stay on the machine that shared the page. Other members read and wait through the hosted home (`mostra results <id> --cloud --org acme`). An organization that wants a page to outlive laptops links an always-on instance to its home, which needs nothing new.

6. **Adoption moves an artifact to another member's instance.** `mostra adopt <artifact> --org acme` makes the caller's instance the owner instance: it takes the versions it can (its own builds, a bundle), fetches a client-only copy of the rest from the hosted home, imports the artifact's submissions, and then the server makes its link the route's owner, so the pending deliveries and the unsent runs go to it, in order. No delivery row is rewritten: a hosted home sends each pending delivery to whoever the route names then. Runs the old owner had accepted and never finished become `unknown`. An admin may adopt anything. A member may adopt their own artifacts on a new machine, and anything its owner released.

7. **Removal is immediate and complete.** `removeMember` deletes the row, revokes the person's grants on that home, and closes their bindings before it resolves. Access is judged against the member list at every request, so a cached token opens nothing. Their artifacts keep serving pages and taking answers. Their deliveries and unsent runs wait for an adopter.

8. **The sender line names the organization, then the member.** "Sent by Acme" with the verifier the operator recorded for the organization's name, and under it the member whose instance owns the page, with their own verifier. Both are text in the trusted chrome. An organization name no operator verified is labelled unverified, as a person's is. An operator's link policy may hide the member.

9. **The operator contract grows additively, inside `OPERATOR_REVISION` `2026-11-08`.** Port queries keep `account` as the owning account (now possibly an organization) and gain `actor`, the member who acted. The handle gains the membership calls, `transferHome`, and calls to list and revoke linked instances.

10. **No artifact moves between homes.** A label never moves to another home (D165), so a personal page enters an organization's home by being shared there again (a new route, new links), or by the operator transferring the person's *whole* home to the organization, which re-issues nothing and asks the person's chat hosts to be approved again.

### Where it is built

Three one-session packages after WP-27, before the terminal packages: **WP-33** (the server and the operator contract), **WP-34** (the owner's link and the CLI) and **WP-35** (reading across members and adoption). All are additive and ship in minor releases. After WP-34 a team shares into one home under one sender, and a member who leaves loses access at once. WP-35 is what makes a page survive its sharer.

### The decisions (section 9 has the reason for each)

| # | Question | Decided |
|---|---|---|
| D-1 | What owns the home | An account of kind `organization` |
| D-2 | Where membership lives | In the server's directory, written only through the operator's handle |
| D-3 | Roles and rights | `member` and `admin`; members read, the owner member and admins manage, the owner link runs; an artifact may be `private` |
| D-4 | Who may adopt | Admins; a person for their own artifacts; any member once the owner released it |
| D-5 | Versions the adopter lacks | Fetched as client-only copies |
| D-6 | Moving between homes | Never one artifact: share again, or transfer the whole home |
| D-7 | Self-hosters | No organizations without an operator module; a documented example module |
| D-8 | The sender line | The organization, then the member; a link policy may hide the member |
| D-9 | Chat hosts | The home is chosen on the consent page |
| D-10 | Packages | WP-33, WP-34, WP-35, after WP-27 and before WP-22 |
| D-11 | Words | "Organization", `--org <handle>`, `member` and `admin` |
| D-12 | Revoking a linked instance | By its own account, a home admin, or the operator |
| D-13 | Pending deliveries at adoption | They follow the route; no delivery row is rewritten |

---

## 2. Grounding: what the code does today

Paths are under `packages/runtime/src/` unless they start with `packages/` or `docs/`.

### One account, one home, one session

| Fact | Where |
|---|---|
| A home has exactly one owner account, and an account at most one home | `server/directory.ts:31-37` (`owner_account_id TEXT NOT NULL UNIQUE`); `server/auth.ts:412-424` (`homeFor` finds or makes it) |
| A token names an account, and the home is looked up from the account | `server/auth.ts:866-871` (`SELECT id FROM home WHERE owner_account_id = ?`); `Authenticated` carries one `accountId` and one `homeId`, `server/auth.ts:42-55` |
| A grant holds an account, a client, a resource and an optional instance link. It holds no home | `server/directory.ts:112-121` |
| An instance link belongs to one account and one home; the first link of an account is its default; one default per account | `server/directory.ts:38-48`; `server/auth.ts:427-459` |
| A sign-in rebinds a link only for its own account | `server/auth.ts:434-443` |
| A binding is one WebSocket on one home: the upgrade opens `who.homeId` and serves that home's protocol server, with the account, grant, home and link as session attributes | `server/api.ts:796-860` |
| A grant's revocation or an account's suspension closes an open binding within the recheck (30 s by default, inside the documented 60 s) | `server/api.ts:27-31`, `813-847`; `accounts.status` is asked at most every 30 s per account, `server/api.ts:229-243` |
| An operator-issued credential names one account and gets one instance link per `subject` on that account's home | `server/auth.ts:1009-1056`; `server/api.ts:279-288` |

### One owner instance per artifact

| Fact | Where |
|---|---|
| A route belongs to a home and an artifact, with one `owner_link_id` | `server/directory.ts:56-64` |
| The first push mints the route and its label for the pushing link; a push from another link is refused with `MOSTRA_REMOTE_NOT_OWNER_INSTANCE` | `server/hosted.ts:287-341`, `783-790` |
| A label is issued once and never moves to another home (triggers) | `server/directory.ts:65-81` |
| A submission's one delivery owner is its route's owner link, connected or not | `server/hosted.ts:277-283` |
| Relayed runs carry their owner link and a sequence unique per link | `ledger/migrations.ts:821-833`; `server/hosted.ts:434-446` |
| `hosted/submission` answers only the instance a submission was delivered to | `server/hosted.ts:1118-1131` |
| Beyond push and `hosted/submission`, no method on a hosted home checks which instance asks: any session of the home may mint or revoke links, change the roster, patch state or pause any artifact | `server/hosted.ts:1113-1163` (the pause handler says "The account's own instances pause and resume as the owner", `1137-1146`) |
| Chat-host authoring goes to the home's default link's newest session | `server/hosted.ts:1318-1331`; `server/mcp.ts:108-121` |

### The owner's side

| Fact | Where |
|---|---|
| The owner keeps one link per server: `remote_link` has `server` as its primary key, and `hosted_artifact`, `version_push` and `remote_missing` reference it | `ledger/migrations.ts:773-809`, `750-756` |
| One connection per server, one credentials file per server | `link/manager.ts:280`, `284`, `632-641` |
| `mostra login` with no server means the server signed in to last | `link/manager.ts:992-1003` |
| The follow copies only the events of artifacts this instance owns, and an import refuses a submission of an artifact it does not own, or of a version it does not hold | `link/manager.ts:354-361`, `514-555`; `interaction/imports.ts:112-124`, `282` |
| The owner subscribes to the hosted home's events with no filter, so every instance of a home receives every event of the home and drops what it does not own | `link/manager.ts:715-718`; `interaction/imports.ts:282` |
| For a hosted artifact, only `state/get`, `state/patch`, `live/push` and `roster/*` are forwarded to the hosted home. `wait` and `results` read the owner's own ledger | `link/hosted.ts:23-31`, `60-78`; `docs/design/INTERFACES.md:779` |
| An instance that does not own an artifact has no CLI path to its results. The dossier says it reads "through a session with the hosted home (the SDK, or remote MCP)" | `docs/design/INTERFACES.md:779` |

### Names, limits and counters

| Fact | Where |
|---|---|
| The sender line is the home's owner account's name and its first identity's recorded verifier | `server/index.ts:145-162`; `server/hosted-pages.ts:439-452`; `packages/shell/src/chrome.tsx:17-28` |
| "The owner sees everyone" means the signed-in viewer's account equals the home's owner account | `server/hosted.ts:258-263` |
| Every `limits` query and every counter names the home's owner account | `server/hosted.ts:462-473`, `845-850`, `905-919`; `server/hosted-pages.ts:424-430`, `513-519`; `server/index.ts:383-385`; `server/metering.ts:146-155` |
| Remote MCP acts on the token's account's home and asks `limits` with that account | `server/api.ts:723-751`; `server/mcp.ts:235-240` |
| Consent is kept per account and client. The page that names a page's sender is kept per account and home | `server/authorize.ts:419-422`, `468-486`, `500-503` |
| The device page says "Approving links a machine to your account" | `server/api.ts:154-156`, `188-190` |
| The handle acts on routes and homes. It has no call about members or linked instances | `packages/protocol/src/operator.ts:656-685`; `server/handle.ts:58-171` |

### What the tests pin

- A push from another instance of the account is refused, naming the owner: `packages/runtime/test/integration/binding.test.ts:458-471`, `hosted.test.ts:339-402`.
- A second instance of the account receives nothing and imports nothing: `hosted.test.ts:408-517`.
- Two accounts host one artifact ID on two routes; one home opens nothing of the other; a host an operator gave one home never goes to another: `tenancy.test.ts:118-242`.

### Four findings that shape the design

1. **Several instances on one home already work.** An operator-issued key names any account, and each key `subject` gets its own link on that account's home (`server/auth.ts:1009-1056`). What is missing is everything around it: a person's own sign-in can't choose a home, an instance can't hold two links on one server, the sender line has no name for such an account (`credentialSession` inserts it with a NULL name), and nothing says who acted.
2. **A linked instance can be cut off only from itself.** The only writes that revoke a grant are a token presented to `/oauth/revoke` (`server/auth.ts:819-836`), a refresh token reused after its grace (`server/auth.ts:578`) and an authorization code presented twice (`server/auth.ts:680`). Nothing ever sets `instance_link.revoked_at`: the one statement that writes it clears it (`server/auth.ts:441`). The handle has no call for it either. So a lost laptop's link stays live until its refresh token lapses (90 days, `server/auth.ts:29`) or the account is suspended. Shared homes make this gap matter.
3. **Every instance of a home is sent every event of the home.** That is harmless for one person's machines. In a shared home it would put every colleague's page traffic on every member's laptop.
4. **A delivery's owner can't be rewritten.** The home ledger's trigger `delivery_terminal` refuses any change of a delivery's `port_owner`, and `delivery_kept` any delete (`ledger/migrations.ts:338-347`). `relay_run` has no trigger. The outbox keeps one queue per stored `port_owner` (`interaction/outbox.ts:150-154`, `225`). So adoption must hand over pending deliveries without touching their rows, by changing where the outbox sends them (4.5).

---

## 3. Journeys

Written before the shapes. Acme is the organization, Ada its owner, Bo and Cy its members. `api.example` is the server.

**J-A. Ada creates Acme and its home.** Ada creates the organization in the operating layer's own pages. The operating layer calls `server.setOrganization({ account: "org_acme", name: "Acme", handle: "acme", verifiedBy: "acme.example" })` and `server.setMembers(home, [{ account: ada, role: "admin" }])`. Nothing else happens on the open server. Ada already has her own home and her own links, and they are untouched.

**J-B. Bo shares a page into Acme's home.** On his laptop:

```text
$ mostra login api.example --org acme
Open https://api.example/device and enter BCDF-GHJK
  (the page says: "Approving links this machine to Acme's pages, as Bo Diaz.")
Linked to Acme on api.example as Bo Diaz (member).

$ mostra share ./proposal --cloud --org acme
https://usercontent.example/a/rte_…#t=…
```

His instance now holds two links on `api.example`: his own home and Acme's. The page's sender line reads "Sent by Acme" and, under it, "shared by Bo Diaz · verified with GitHub". His agent's `mostra wait ./proposal --until submitted` returns as today, because his instance is the page's owner instance.

**J-C. Cy reads the answers, then updates the page.** Cy never held the page. She reads and waits through the hosted home:

```text
$ mostra list --cloud --org acme
art_proposal  "Q3 proposal"  owner: Bo's MacBook (connected)  2 submissions
$ mostra results art_proposal --cloud --org acme
```

Bo goes on leave. Cy has the project's source. Bo released the page before he left (`mostra release ./proposal --org acme`), or Ada, an admin, does this herself:

```text
$ mostra adopt ./proposal --cloud --org acme
Adopted "Q3 proposal" from Bo's MacBook: 3 versions (2 built here, 1 fetched without its server code),
2 submissions imported, 1 pending delivery and 0 waiting runs moved.
$ mostra publish ./proposal        # pushed to Acme's home, as every later publish is
```

From then on Cy's instance receives the page's deliveries and runs its actions with her machine's secrets. The links respondents hold never changed.

**J-D. A respondent answers.** Dee opens the link on her phone. The trusted chrome says who sent the page: Acme, and the member responsible for it. She answers and sees "Your answer was sent." If she signs in, the server's page says "Continue as Dee to answer Acme's page? Acme's members will see your name with your answers." She never learns whose laptop is asleep.

**J-E. An agent in a chat host acts for Bo.** Bo adds the server's MCP endpoint to his chat host. The consent page asks where the host may act: "Your own pages" or "Acme". He picks Acme. The agent's reading tools see every page of Acme's home. Its authoring tools build on Bo's default instance among those linked to Acme's home, and answer `MOSTRA_REMOTE_NO_INSTANCE` when he has none connected. A publish there is shared into Acme's home.

**J-F. The operating layer adds, removes, suspends and bills.**
- *Add:* Cy accepts an invitation in the operating layer; it calls `server.setMember(home, { account: cy, role: "member" })`. From that moment Cy may link a machine or a chat host to Acme.
- *Remove:* `server.removeMember(home, bo)`. When it resolves, Bo's grants on Acme's home are revoked and his bindings to it are closed.
- *Suspend:* `server.suspendHome(home, reason)` as today: pages, bindings, pushes and MCP calls of Acme's home are refused. Members' own homes are untouched.
- *Bill:* every `limits` query and every counter names `account: "org_acme"`, so Acme's entitlements apply to everything in its home. Queries a member caused also carry `actor`, so the operating layer can count seats that are used and refuse a member who has none.

**J-G. Bo leaves with answers pending and actions waiting.** The operating layer removes Bo. His laptop's binding closes with "membership ended", and its next refresh is refused. His pages keep serving, drafts keep saving and answers keep arriving in Acme's home. Deliveries for his pages wait. Runs never sent to his machine wait until their offline limit. Runs his machine had accepted and not finished become `unknown` at once, since their end can never be reported. Ada adopts his pages on her machine, or on Acme's always-on instance, and the waiting deliveries arrive there in order.

**J-H. Cy's laptop is stolen.** Cy, from another machine, or Ada as an admin, revokes that instance: `mostra logout api.example --org acme --instance lnk_…`. The operating layer can do the same from its console (`server.revokeInstanceLink`). The laptop's link stops opening bindings within the bound. Cy links her new laptop and adopts her own pages there. No admin is needed for that.

**J-I. A self-hoster with no operator module.** Everything is as today: each person who signs in has their own home. `mostra login server.example --org acme` answers `MOSTRA_REMOTE_HOME_UNKNOWN`. A self-hoster who wants one shared home loads a small operator module that names the organization and its members from a file; the docs carry it as an example.

---

## 4. The design

Each item gives the candidates, the winner, and what the winner took from the loser.

### 4.1 Ownership

**Candidates.**

- **(a) An organization account.** `account.kind` is `person` or `organization`. An organization account owns a home exactly as a person's does. It has no sign-in identity, so nobody signs in as it. People act on its home as members.
- **(b) A home with no owning account.** `home.owner_account_id` becomes nullable and the home carries its own name, verifier and member list. Every port query that says `account` then needs a second meaning or a new field, because `LimitQuery.account` is required and is what an operating layer keys entitlements by.
- **(c) An organization instance and nothing else.** No member links at all. The organization runs one always-on instance, linked with an operator-issued key, and members hand it each artifact as a bundle. This works on today's server, but every share needs that machine and a hand-over, and a person's own sign-in still can't reach the organization's pages.

**Winner: (a).** It changes one column's domain and leaves every sentence of the form "the account that owns the home" true. The directory's `UNIQUE (owner_account_id)`, the route and label rules, `routing.resolve`'s `home`, and every `account` field in the operator contract keep working unchanged. An operating layer that names the organization's account with its own ID (as `accounts.resolve` already lets it name people's) finds its entitlements by the same key it uses today.

**Borrowed from (c):** the organization account may hold operator-issued credentials like any account (`accounts.authenticate` answering the organization's account). So an always-on instance of the organization is one more link of its home, with no new mechanism. **Rejected in (b):** a second meaning for `account`.

**What `home.owner_account_id` becomes.** Unchanged in shape: one account, unique. It may now be an organization's.

**What a token names.** A grant gains `home_id`. `NULL` means "the account's own home", which is every grant that exists today. A grant with a home acts on that home and no other. `Authenticated` gains `role` and keeps one `accountId` (the person) and one `homeId`.

**Several organizations and a home of one's own.** A person is a member of any number of organization homes and still owns at most one home. Each session knows its home because its grant names it: a binding is opened with a token of one grant, so it serves one home (as `server/api.ts:796` already does); a chat host's token is of one grant; a viewer's session belongs to a route, which belongs to a home.

**Three terms, used from here on.**
- The **owning account** of a home: a person, or an organization.
- The **actor**: the account a credential names. On a person's own home the actor is the owning account.
- A **member**: a person on an organization home's member list, with a role.

### 4.2 Membership as the server sees it

**Candidates.**

- **(a) Pushed and stored.** The operator sets the member list through the handle. The server keeps it in its directory and judges every request against it locally.
- **(b) Pulled and cached.** A port, `accounts.access({ account, home }) → role | null`, asked when a member links, opens a binding, pushes or calls MCP, cached for `cacheForMs`. The server keeps nothing durable.
- **(c) Carried by sign-in.** `accounts.resolve` answers the person's memberships, refreshed at each sign-in.

**Winner: (a).**

| | (a) pushed | (b) pulled | (c) at sign-in |
|---|---|---|---|
| A request's cost | A local read | A port call on the path of every binding, push and MCP call, or a cache | A local read |
| Operator away | Nothing changes: members keep working, the removed stay removed | Creating operations fail closed (D165 item 9), so members' machines lose their links and their deliveries and runs stall | Nothing changes, and neither does a removal |
| Removal bound | Immediate when the call resolves | The cache's age | The next sign-in: unbounded |
| "Which homes may this person choose?" (the device page, the consent page) | A local query | A second port | Known only at sign-in |
| Drift | Possible if the operator's call fails after its own commit | None | Large |

**Borrowed from (b):** defence against drift. `setMembers(home, members)` replaces the whole list, so an operator reconciles at start and whenever it likes, and `members(home)` reads the list back. Also borrowed: access is judged at every request from the stored list, never from what a token was issued with, so a token never outlives a membership.

**The source of truth** is the operator for *who should be a member*, and the server's directory for *who is one right now*. The server never changes the list on its own.

**The bound.** When `removeMember` (or a `setMembers` that omits someone) resolves:
1. the member row is gone, so `authenticate` refuses every token of every grant that person holds on that home (`/host`, `/files`, `/mcp`);
2. those grants are revoked in the same transaction, so a refresh answers `invalid_grant` with a message that says the membership ended;
3. every open binding of that person on that home has been closed (4403, "membership ended"), as `suspendHome` closes a home's bindings today (`server/handle.ts:104`).

Stated bound: **at once on the server process that holds the home, and within the binding recheck (30 s, documented as 60 s) in any case**, since the recheck now also re-reads the member row. A viewer session is unaffected: a removed member who holds a page's link is a link holder like any other (4.13).

**While the operator can't be reached**, nothing about membership is asked, so nothing fails. A removal the operator could not deliver is late by exactly the operator's own delay. That is the operator's to retry, and `setMembers` at its next start repairs it.

### 4.3 Roles and permissions

**The open server's part is one small table.** Two roles, three rights.

| Right | What it covers on a hosted home | A member, on an artifact their instance owns | A member, on a colleague's artifact | An admin | The owning account's own credential |
|---|---|---|---|---|---|
| **Read** | `artifact/list`, `artifact/get`, `results/*`, `wait`, `events/*`, `state/get`, `roster/get`, `hosted/links` | yes | yes, unless the artifact is `private` | yes | yes |
| **Manage** | `view/url`, `view/rotate`, `view/revoke`, `roster/add`, `roster/remove`, `state/patch`, `live/push`, `artifact/pause`, `artifact/access`, `artifact/release`, `share/stop`'s revocation | yes | no: `MOSTRA_REMOTE_ROLE_DENIED` | yes | yes |
| **Run** | `hosted/push`, the `submissions` and `relay` ports, `hosted/submission`, relayed authoring | yes: it is the owner link | no: `MOSTRA_REMOTE_NOT_OWNER_INSTANCE`, naming the owner | only on what its own instance owns | only on what its own instance owns |
| **Share something new** | the first `hosted/push` of an artifact ID the home doesn't host | yes | | yes | yes |
| **Adopt** | `hosted/adopt.*` (4.5) | its own artifacts, on another of its machines | only one its owner released | yes | yes |
| **Change members, suspend, remove** | never a protocol method: the operator's handle only | no | no | no | no |

- On a person's own home the actor is the owning account, which has every right. Today's behavior is unchanged, including that any instance of the account manages any of its artifacts.
- "Its instance owns it" means the route's owner link belongs to the actor's account. So a person's second laptop manages what the first shared.
- **Why members read by default, and what `private` is for.** A shared home is one team's pages, and reading a colleague's answers is why it exists. But one page in fifty holds answers not everyone should see: a salary survey, a complaint form. So an artifact has one of two access settings, kept on its route: `organization` (the default) or `private`, which only its owner member and admins read. A private artifact is not listed for anyone else, and `artifact/get` answers them as for an artifact the home doesn't host. Its owner member or an admin changes the setting (`artifact/access`, `mostra share … --private`). Admins always read: an admin can adopt any page, so hiding one from them would only pretend.
- **Why members don't manage a colleague's artifact:** minting a link widens a page's audience, a roster change decides who is expected, and a state write changes what respondents see. Those are the sharer's calls. A small team that wants everyone to do everything makes everyone an admin.
- **Why "run" is not a role's right at all:** pushing a version changes what every holder of an existing link sees, and the pushing machine must be the one that runs that version's server code. Both follow from D165 item 1b, so the rule stays "only the owner link", and changing the owner link is its own explicit act (4.5).

**Design it twice.** The other candidate was per-artifact access lists (each route with its own readers and managers). It is what an enterprise will ask for and it is more than a team needs. It also puts policy administration into the core, which D165 item 11 keeps out. The winner borrows its seam: the check is one function, `may(session, artifactId, right)`, applied to every handler from one table of method to right, so a later access list replaces the function's body and no caller. It also borrows the loser's smallest case: two settings need no list and no administration, cost one column, and answer the first question any larger team asks.

**Extension points, in order of reach.**
1. `limits.check` carries `actor` on every operation a member causes (`share`, `version.push`, `storage`, `link`, `mcp.call`). An operator refuses per member with its own message: a seat that may read and not share, a member past their own quota.
2. Roles are a closed set in this revision (`member`, `admin`). A further role is an additive enum value with its row in the table above.
3. Organization-wide policies (forbid public links, require signed-in respondents, lists of named readers per artifact, `private` as a home's default) are `ee/` or operator features (D118), built on `policy.link`, `limits` and the seam above.

### 4.4 Owner instance, delivery and the relay

**The question.** Whatever owns the home, some machine holds each page's versions and secrets and runs its server code (D117, D165 items 3 and 4), and each submission has one delivery (D165 item 1b). Which machine, and how do the other members see the answers?

**Candidates.**

- **(a) Per-artifact owner instances, and the others read through the hosted home.** The instance that shares a page owns it, as today. Any member's instance forwards `wait`, `results`, `events` and `artifact/list` for an artifact it doesn't own to the hosted home over its own link.
- **(b) Every member's instance imports everything.** Each member link follows all of the home's events and reads every submission into its own ledger. The local ledger requires the submission's version (`interaction/imports.ts:116-124`), so every member's machine would need every version of every page. That spreads builds, and with them server code, to machines that never asked for it, and multiplies every answer by the head count.
- **(c) One organization instance.** An always-on machine linked with the organization account's key owns every page. Members hand pages over as bundles. Deliveries and actions never depend on a laptop. But an operator may not be willing to run customers' server code, an organization may not have a machine, and a person can't just share from where they work.
- **(d) Delivery to several instances.** A submission delivered once per member link. It breaks "exactly one delivery" and makes every host on every machine dedupe.

**Winner: (a), with adoption (4.5) as the way a page changes hands.**

- It keeps D165 item 1b and D166's relay rules word for word: one owner link per route, sequences per link, reconciliation per link.
- **Borrowed from (c):** an organization instance is simply a link of the home whose credential is the organization account's. Nothing new is built for it, and adoption is how pages get onto it. The docs recommend it for pages that must outlive any one person.
- **Borrowed from (b):** the reading path. A member's CLI and agents read any page of the home. They get it from the one copy, the hosted home, which already serves those methods to any session (`docs/design/INTERFACES.md:751`).
- **Rejected (d)** outright.

**Where each thing goes.**

| Traffic | Goes to |
|---|---|
| A submission's delivery | The route's owner link, once, in order (unchanged) |
| A relayed run or call, live producer interest | The route's owner link's newest session (unchanged) |
| Chat-host authoring | The actor's default link *on that home* (today: the account's default link; the default becomes per account and home) |
| The sync follow | Each link's subscription now carries only the events of artifacts that link owns. The server filters; the owner keeps its own filter too |
| `wait`, `results`, `events`, `artifact/list` from a non-owner | Forwarded to the hosted home and answered there |

**Reading across members, exactly.** The owner instance's methods `wait`, `results/get`, `results/list`, `events/read`, `artifact/list` and `artifact/get` take an optional `hosted: { server?, org? }`. With it, the call is forwarded over that link and answered by the hosted home, whether or not this instance owns the artifact. Without it, they read the local ledger as today. On the CLI it is `--cloud [<server>] [--org <handle>]`. A wait forwarded this way holds no local state: if the binding drops, the CLI's wait answers `MOSTRA_REMOTE_UNREACHABLE` and the caller repeats it with its cursor, as any wait that timed out.

**What a non-owner never gets:** a delivery to its local hosts. A host on Cy's machine is woken by Bo's page only through a wait she runs. That is the honest cost of one delivery per submission, and it is the same for a person's second laptop today.

### 4.5 Adoption, and moving artifacts between homes

#### Adoption: a page changes its owner instance

**The problem.** Versions and secrets live only on the owner instance. When that machine or its owner is gone, the page's actions and deliveries have nowhere to go. And a colleague who updates the page must become the machine that runs the new version.

**Candidates.**

- **(a) The adopter drives it, and the server moves what is pending.** The adopting instance prepares itself (versions, history), then asks the server to commit the change.
- **(b) The last pusher owns.** Any member's push takes the route. Two members publishing the same afternoon flip the owner back and forth, with deliveries and runs bouncing between two machines. Ownership would change as a side effect of a build.
- **(c) The operator reassigns.** A handle call moves the route to a named link. But the target instance must already hold the artifact, its versions and its history, or it refuses every delivery (`interaction/imports.ts:112-124`). So the instance has to take part anyway.
- **(d) Co-owners.** A route with several owner links, one of them active. It needs a rule for which is active, which is adoption again with more state.

**Winner: (a).** Ownership changes by one explicit, recorded act of the machine that takes the page. **Borrowed from (c):** the operator sees it (an `artifact.adopted` event with the actor) and can refuse it (`limits` operation `adopt`). **Borrowed from (b):** nothing is asked of the previous owner, so adoption works when that machine is gone.

**Who may adopt** (4.3): an admin; the owning account's own credential; the same person on another of their machines; any member, once the owner released the page (`artifact/release`).

**The steps.** `remote/adopt { artifact, server?, org? }` on the adopter's instance:

1. **Begin.** `hosted/adopt.begin { artifactId }` checks the right and answers the route, its current owner link (ID, name, account, whether it is connected) and the route's versions (ID, number, digests).
2. **Versions.** For each version of the route:
   - the adopter holds it already (it published the same source in the same environment, so the ID is the same, D89; or it imported a bundle, RM-01): nothing to do;
   - otherwise it fetches a **client-only copy** from the hosted home: `hosted/version { artifactId, versionId }` answers what a push carried (`manifest.json`, `registry.json`, `lock.yaml`, the full listing), and `GET /files/<sha256>` serves the client files this home holds. The adopter checks them against `outputDigest` as the server did, and records the version as held *without server code*.
   
   A client-only copy lets every submission import (its version exists) and results render. It can run nothing: a relayed run of that version ends `failed` with reason `owner-refused` and a message naming the instance that had its code. The adopter's next publish gives viewers a version whose actions work.
3. **History.** The adopter imports every submission of the artifact with `hosted/submission` (opened to the route's adopter-in-progress and to its owner link) and copies the artifact's events from cursor 0, each once by its origin. A submission the hosted home had already delivered to the old owner is imported **without** a local delivery: it was delivered once. Pending ones will arrive as deliveries.
4. **Commit.** `hosted/adopt.commit { artifactId, from: <the owner link seen at begin> }`. The server:
   - asks `limits` for `adopt` (fail closed when the operator doesn't answer: it creates an owner);
   - writes its plan to `artifact_route.adopting_json` first, as a removal writes `removing_json` (`server/hosted.ts:1241-1267`), so a commit cut off between the directory and the home's ledger is finished by the next call;
   - stops sending the artifact's deliveries and runs, and waits for a delivery call in flight to the old owner to settle (at most its 30 s);
   - in the home's ledger, in one transaction: runs never sent go to the new link with fresh sequences above its floor, keeping their offline clocks; runs the old owner accepted, or that were sent and not acknowledged, stay the old link's; `artifact.adopted { from, to, by }` is appended, and the operator is handed the same event;
   - in the directory: `artifact_route.owner_link_id` is the new link, compare-and-set on `from`. From that moment the artifact's pending deliveries go to the new link, in their order, because a hosted home sends each one to its artifact's owner link as the route names it then.
5. **After.** The old owner's instance follows `artifact.adopted`, marks its `hosted_artifact` row released and stops pushing. It keeps what it imported. If it is connected, the runs it had accepted finish and report as today, since those rows are still its link's. If its owner was removed, those runs became `unknown` at the removal (4.12).

**Why no delivery row moves.** The home ledger refuses any change of a delivery's owner (`delivery_terminal`, `ledger/migrations.ts:338-343`). Three ways to hand pending deliveries over:
- *(a) Lift the trigger inside the commit* and rewrite `port_owner`, as a removal lifts the write-once triggers (`server/hosted.ts:1271`). It works, and it makes a second escape from a rule that says a delivery's identity never changes.
- *(b) Close the old delivery and insert a new one.* A submission then has two delivery rows, against "exactly one delivery per submission" (D165), and the first would end in a state that reads as a failure.
- *(c) Resolve the owner when sending.* On a hosted home the outbox sends a pending delivery to its artifact's owner link as the route names it at that moment. The row keeps the link that owned the route when the submission was committed, as a record.

**Winner: (c).** The route is then the one place that says who owns an artifact, no constraint is weakened, a submission keeps its one row, and the commit doesn't touch deliveries. **Borrowed from (a):** order. The adopter's queue merges the adopted artifact's pending deliveries with its own by position, so each owner link still receives one at a time in submission order (D105). `hosted/submission` follows the same rule: it answers the route's owner link.

**Concurrency.** Two adopters: the commit is compare-and-set on `from`, so the second is refused with the new owner named. A push by the old owner racing the commit: the push checks the owner link inside the directory transaction, so it lands before the commit (and the adopter fetches that version on its next follow of `version.published`) or is refused after it. A submission committed during the commit gets its delivery row as always, and is sent to whichever link owns the route when its turn comes.

**The one accepted boundary.** A delivery the old owner committed whose acknowledgement was lost in the moments before the commit is sent to the new owner too. Both machines then hold that submission and each tells its own hosts once. The hosted home still has one delivery row. The same shape as the relay's accepted boundary (FAILURE_MODEL §11.1).

**Secrets** never move. The adopter sets its own (`mostra secret set`). A relayed run that asks for a secret the adopter lacks fails as it does on any machine that lacks it.

#### Moving an artifact between homes

**The constraint.** A label is issued once and never moves to another home, so no origin, with the browser storage it holds, passes to another tenant (D165, `server/directory.ts:73-81`). A route can't change homes.

**Candidates.**

- **(a) Share again.** `mostra share ./page --cloud --org acme` on a page already shared personally makes a second route, in Acme's home, with new links. The personal route keeps working until `share stop`. Nothing migrates. The owner's ledger holds both audiences' submissions, each with its origin.
- **(b) Move the route.** Copy the artifact's rows from one home's ledger to another's and rewrite the directory. It breaks the label rule, is not atomic across two ledgers, and must renumber cursors that an owner already committed.
- **(c) Transfer the whole home.** The operator moves a person's home to an organization account: `transferHome(home, toAccount)`. One directory transaction. No route, label, link, draft or submission is touched, because the home is the same home. The person becomes an admin member. Their machines' grants are pointed at the home explicitly, so their links keep owning their routes. Their chat hosts' grants on it are revoked: those were approved for "your own pages" and must be approved again for the organization. The page that tells a signed-in viewer whose page they answer is shown again.

**Winner: (a) for one artifact, (c) for "this account becomes a team".** **Rejected: (b).** What (a) borrows from (b): a stopped share may say where it went. `share/stop { moved: true }` leaves the old links showing a trusted-chrome line, "This page has moved. Ask its sender for the new link.", instead of the bare revoked page. It names no destination, since a capability link can't be derived from another.

**And back.** An artifact leaves an organization's home the same way: shared again from the person's own link, then stopped in the organization's. A whole home transfers back with the same handle call, to a person who owns no home and is its only remaining member.

**Drafts and submissions in flight** stay where they were made. A respondent mid-draft on the old link keeps their draft there until the share is stopped. The docs say to stop the old share only once its expected answers are in.

### 4.6 The owner's link and the CLI

**Candidates for "an instance and several homes".**

- **(a) One link, and one connection, per server and home.** Each is its own grant, refresh token, `lnk_` ID, sync cursor, relay mark and WebSocket.
- **(b) One connection per server, carrying a session per home.** One sign-in, one socket, a home named in every message.

**Winner: (a).** The server already serves one protocol server per home and one home per socket (`server/api.ts:796-860`), and every per-link invariant (relay sequences, the follow cursor, the restore witness) is per home already. (b) would add a routing layer to the binding and make one revoked membership a partial failure of a shared connection. **Borrowed from (b):** one command shows everything: `mostra status` lists every link of every server together.

**On the owner's ledger** `remote_link` gets a local key, and its children reference it (5.4). A server and home appear once. The personal link of a server stays unique.

**Naming the home.** An organization home has a **handle**: a lower-case name unique on the server (`acme`), set by the operator. Where none is set, the home's ID works in its place. A handle that names no home the person may act on, and one that names no home at all, get the same answer (`MOSTRA_REMOTE_HOME_UNKNOWN`), so the command is no oracle for which organizations exist.

**Commands** (help text is prose for D149):

```text
mostra login <server> [--org [<handle>]] [--default] [--key-file <file>]
mostra logout [<server>] [--org <handle> | --personal] [--instance <lnk_…>] [--forget]
mostra status                                  # every link: server, home, role, state
mostra share <artifact> --cloud [<server>] [--org <handle> | --personal] [--private] […]
mostra access <artifact> organization|private [--cloud [<server>]] [--org <handle>]
mostra list|results|wait|roster get|state get <artifact> --cloud [<server>] [--org <handle>]
mostra adopt <artifact> --cloud [<server>] [--org <handle>]
mostra release <artifact> [--cloud [<server>]] [--org <handle>]
```

- `mostra login <server>` with no `--org` links the person's own home, as today.
- `--org` with no handle lets the person choose on the device page among the organizations they belong to.
- **Which home a share goes to.** In order: the home named; else the only home this instance is linked to on that server; else the home the artifact is already hosted on there; else `MOSTRA_REMOTE_HOME_AMBIGUOUS`, listing the choices. Nothing is ever shared under an organization's name by a default the person didn't see.
- `mostra logout <server>` signs out of every link on that server; `--org` or `--personal` of one. `--instance` revokes another machine's link (4.13, J-H).

### 4.7 Remote MCP and chat hosts

**Candidates.**

- **(a) The home is chosen on the consent page.** One endpoint. A grant for `/mcp` gains the same `home_id`. An account with organization memberships sees the choice as part of consent, with its last choice preselected.
- **(b) An endpoint per home.** `https://api.example/mcp/org/acme` as its own resource, with its own protected-resource metadata. A person adds one connector per home.
- **(c) A home parameter on every tool.** It changes the thirteen frozen tool schemas (D32) and asks every agent to carry a value the person already chose.

**Winner: (a).** A chat host's directory lists one endpoint, so a choice at connection time is the only one that reaches every install. **Borrowed from (b):** the choice is as explicit as an address: the consent page names the home in its heading, and the tool results name it (`artifact_list` answers the home's name beside its artifacts). (b) itself stays an additive later option for people who want two homes side by side in one chat host. **Rejected: (c).**

**Consent shows the choice** as text the server renders: "Chat App asks to use Mostra as Bo Diaz, in: ( ) your own pages ( ) Acme". An account with no memberships sees today's page. The page is shown whenever the account has more than one home to choose from, even for a client it approved before, since the choice is part of what is approved.

**Where authoring goes:** the actor's default instance among their links to that home. No such instance connected: `MOSTRA_REMOTE_NO_INSTANCE`, whose hint says `mostra login <server> --org acme --default`. The artifact a chat host publishes is owned by that instance and sits in the chosen home.

**Reading tools** see the whole home, by the read right. `state_patch` and `live_push` need the manage right on the artifact.

### 4.8 What respondents see

**Candidates for the sender line of an organization's page.**

- **(a) The organization, then the member.** "Sent by Acme · verified …" and, under it, "shared by Bo Diaz · verified with GitHub".
- **(b) The organization alone.**
- **(c) The person, with the organization in brackets.**

**Winner: (a).** A respondent decides whether to trust a page by who is asking. An organization's name is worth more than a person's and easier to fake, so the line must say who vouches for it. And the person line is what makes "Acme" accountable to someone a respondent may know. (c) puts the weaker claim first. **Borrowed from (b):** when no member can honestly be named, the line is the organization's alone (below).

**Whose names, verified by whom.**

- **The organization's name** is the owning account's name. Its verifier is a label the operator records through `setOrganization` (`verifiedBy`, 1 to 64 characters, shown as text), kept on the home exactly as an identity's verifier is kept on the identity (D169 item 6). No label: the name is shown as "name not verified", as a person's is. The open server verifies nothing itself: it has no way to, and a self-hoster's module says what it checked.
- **The member** is the account of the route's owner link, shown only while that account is a member of the home. A removed member's name is never shown as vouching for a page. Until someone adopts the page, the line is the organization's alone.
- A page owned by the organization account's own instance shows the organization alone.

**Shape.** `HostedChrome.sender` gains `kind` and `member`, additively:

```ts
sender?: { name: string; verifiedBy?: string;
           kind?: "person" | "organization";                 // absent: person
           member?: { name: string; verifiedBy?: string } }; // only with kind "organization"
```

All of it is text in the trusted chrome (invariant 7), under the shell's existing rules for tenant strings (ARCHITECTURE §15.6).

**Draft wording, for Mirza's review (D149):**

| Case | Line |
|---|---|
| Verified organization, verified member | "Sent by Acme · verified by acme.example" / "shared by Bo Diaz · verified with GitHub" |
| Unverified organization | "Sent by Acme · name not verified" |
| No member to name | "Sent by Acme · verified by acme.example" |
| Viewer sign-in, the server's page | "Continue as Dee to answer Acme's page? Acme's members will see your name with your answers." |
| The device page | "Approving links this machine to Acme's pages, as Bo Diaz. This machine's Mostra can then host pages under Acme's name and receives their answers." |

**Hiding the member.** The member shows by default, because a named person is what makes an organization's page accountable to its reader. Some organizations must not show staff names to the public (a support desk, a safety team). `policy.link` may answer `showMember: false` for a link, and the line is then the organization's alone. With no operator module the member always shows.

### 4.9 Teams (D168)

Nothing in D168's model changes. Four places read "the owner", and each gets one answer.

| D168's rule | On an organization's home |
|---|---|
| "The artifact's owner … sees everyone whatever the setting" (item 8; `server/hosted.ts:258-263`) | A signed-in viewer who has the **read right on the artifact** (4.3): the owning account, an admin, its owner member, and every member unless the artifact is `private`. So a member's view of a page shows nothing they could not read through the protocol. A removed member is an ordinary viewer at their next request |
| Delivery states shown "only when the signed-in viewer is the owner" (D165 item 1a) | The same test |
| A hosted artifact's roster is its hosted home's (item 9) | Unchanged. `roster/get` is a read; `roster/add` and `roster/remove` are manage. `roster/add` asks `limits` for `link` with `actor` |
| `submitted:all` answers on the owner instance from the events it follows (item 4) | Unchanged for the owner instance. Any other member asks the hosted home (`wait … --cloud --org acme`), which holds the roster and answers the same condition from its own events |

- **Visibility `private`** (D168 item 8) still shows a respondent only themselves. It is a different setting from an artifact's access `private` (4.3): the first is what respondents see of each other, the second is which members read the artifact. Members who may read it see everyone because they are the sender.
- **Invitations.** `Invitation.sender` stays the home's sender (the organization's name and verifier) and gains `member`, the same member the sender line names. An operator's mail then reads "Bo Diaz at Acme", from data, in its own words.
- **Refs.** A roster names people by the host's own key (D104). Two members' agents may use different keys for one person; the roster is per artifact and manage is per artifact, so they never meet.
- **Presence and attribution** carry per-artifact viewer keys and are unaffected.

### 4.10 The operator contract

Everything is additive within `OPERATOR_REVISION` `2026-11-08`. Exact shapes are in 5.1. The principles:

1. **`account` keeps its meaning: the owning account.** For an organization's home it is the organization's account. So entitlements, quotas, storage and cost of everything in the home fall on the organization with no change to a module that doesn't know organizations exist.
2. **`actor` says who did it,** on every query, counter and event a member caused. It is absent when a viewer caused it (`view`, `submit`, `run`, `run.wait`, `call`) and when the owning account itself acted. **A member's action counts against the organization (`account`); `actor` is for seats and attribution.**
3. **Membership goes in through the handle** (4.2), never through a port the server asks.
4. **`accounts.resolve` is unchanged.** It resolves a person. It never names memberships (4.2, candidate (c)). An operator that joins people by a provider's claim (a verified domain in `facts`, D169 item 5) calls `setMember` from its own logic.
5. **`accounts.authenticate` may name a home.** A key answers `{ account, home?, scope, subject? }`. With `home`, the key acts as that member on that home, and the server checks the membership as for any grant. A key for the organization's own account needs no `home`.
6. **Suspension.** `suspendHome` suspends an organization's home and nothing of its members' own homes. A suspended *person* (`accounts.status`) acts nowhere: not on their own home, not on any organization's (4.12).
7. **Removal of an organization's home** is what it is for any home today: `suspendHome`, then `remove(routeId)` per route. No new call.
8. **Events.** `version.pushed` gains `actor`. A new kind, `artifact.adopted`, tells the operator a page changed hands. Member changes are the operator's own acts and produce no event back.
9. **Limits.** One new operation, `adopt`, which fails closed like the other creating operations.
10. **Policy.** `policy.link` may hide the member on an organization's sender line (`showMember`).

**A module on an older server.** The new handle calls don't exist there. A module that needs them checks `typeof server.setOrganization === "function"` and pins the server it runs in. No revision change is needed, since nothing existing changes meaning.

### 4.11 Data model

Section 5.4 has the tables. In short: the directory gains `account.kind`, `home.handle` and the home's verifier, `home_member`, `grant.home_id`, a default instance per account *and home*, an artifact's access on its route, and (with adoption) `artifact_route.adopting_json` and `released_at`. The hosted home's ledger gains no table and loses no constraint. The owner's ledger re-keys `remote_link` by a local ID so a server can appear once per home. Every existing row keeps its meaning: a `NULL` `grant.home_id` is the account's own home, every existing account is a `person`, and every existing `remote_link` row is its server's personal link.

### 4.12 Failure model

Section 6.1 has the rows, in FAILURE_MODEL §11's style, for every case the brief lists and for STANDARDS' list (invalid configuration, partial persistence, timeouts, cancellation, crash, duplicate execution, stale versions, concurrent clients, host unavailability).

### 4.13 Security

Section 6.2 has the review. The two rules that carry most of it: **access is judged against the member list at every request**, and **a member is a link holder like anyone else once removed**.

### 4.14 Self-hosting and `ee/`

**With no operator module:** there are no organization accounts, because only the handle makes one. Every person has their own home, exactly as today. `--org` answers `MOSTRA_REMOTE_HOME_UNKNOWN`. The directory's new columns hold their defaults. This is coherent and it is the default.

**Candidates for a self-hoster who wants one shared home.**

- **(a) Nothing in the core; an example module in the docs.** About thirty lines: it reads a file naming the organization and its members and calls `setOrganization` and `setMembers` at start and when the file changes. Members are named by account ID, which the server's sign-in page and `mostra status` show.
- **(b) A `sharedHomes` key in the server's configuration.** The core would then own a membership format, its reload and its errors: organization administration by another name (D165 item 11).
- **(c) Server commands** (`mostra-runtime server members add`). The same, with a CLI.

**Winner: (a).** The mechanism is in the open server and complete: a shared home, roles, removal, adoption. Administration stays out. **Borrowed from (b):** the example reads a plain file, so a self-hoster edits one file and never writes code. The integration tests' fixture operator module does the same, so the example is exercised by CI.

**`ee/`** (D118; which features go there is decided with Mirza by the package that first builds `ee/` code): an admin console over the handle; membership driven by SCIM and by an identity provider's groups; an audit log fed by `actor` on events; organization-wide policies and per-artifact access lists (4.3's seam); retention. None of them needs anything from the core beyond what this design adds.

### 4.15 Verification

Section 7 has the checks, their seeded violations and the requirement rows.

---

## 5. Interfaces and data

### 5.1 The operator contract (`@mostra/protocol/operator`), additive

```ts
// ── organizations and their members ─────────────────────────────────────────────────────

/** A member's role on an organization's home (INTERFACES §18.10). */
export type HomeRole = "member" | "admin";

/** One member of an organization's home: a person's account and their role. */
export interface HomeMember {
  /** The person's account, as `accounts.resolve` names it. Made in the directory if it isn't there yet. */
  readonly account: string;
  readonly role: HomeRole;
}

/** The schema the server checks a member against. */
export const HomeMember: z.ZodType<HomeMember> = z.object({
  account: z.string().min(1).max(128),
  role: z.enum(["member", "admin"]),
});

/** An organization: an account no one signs in as, and the hosted home it owns. */
export interface OrganizationHome {
  /** The organization's account, the operator's own ID. Never an account a person signs in as. */
  readonly account: string;
  /** The name its pages show as their sender, as text. */
  readonly name: string;
  /** A lower-case name unique on this server, which `mostra login --org` takes. */
  readonly handle?: string;
  /**
   * Who verified the name, as the sender line says it ("verified by acme.example"): 1 to 64
   * characters, shown as text. Absent: the name is shown as not verified. Recorded on the home,
   * so it changes only when the operator sets it again.
   */
  readonly verifiedBy?: string;
}

/** The schema the server checks an organization against. */
export const OrganizationHome: z.ZodType<OrganizationHome> = z.object({
  account: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  handle: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/).exactOptional(),
  verifiedBy: z.string().min(1).max(64).exactOptional(),
});

/** One instance linked to a home, as the handle and `hosted/links` report it. */
export interface InstanceLinkInfo {
  /** The link (`lnk_…`). */
  readonly linkId: string;
  readonly home: string;
  /** Whose machine it is. */
  readonly account: string;
  /** The machine's name, as it gave it. */
  readonly name: string;
  /** Whether it is its account's default instance on this home. */
  readonly default: boolean;
  readonly linkedAt: string;
  readonly revokedAt?: string;
  /** Whether a binding of it is open now. */
  readonly connected: boolean;
  /** How many hosted routes it owns. */
  readonly routes: number;
}

// ── additions to existing types (every field optional) ──────────────────────────────────

export type LimitOperation = /* … as today … */ | "adopt";

export interface LimitQuery {
  // … as today: `account` is the account that owns the home (a person, or an organization) …
  /**
   * The member who caused the operation, on `share`, `version.push`, `storage`, `link`, `mcp.call`
   * and `adopt` in an organization's home. Absent when a viewer caused it, and when the owning
   * account acted itself.
   */
  readonly actor?: string;
}

export interface MeterCounter {
  // … as today …
  /** The member whose instance or client was counted, on `mcp.calls`, `bytes.stored` and `relay.messages`. */
  readonly actor?: string;
}

export interface PushedVersion {
  // … as today …
  /** The member whose instance pushed the version. */
  readonly actor?: string;
}

export type OperatorEventKind = /* … as today … */ | "artifact.adopted";

export interface OperatorEvent {
  // … as today. `artifact.adopted` carries
  //   { from: { linkId, account }, to: { linkId, account } } …
  /** The member who caused it, on `version.pushed` and `artifact.adopted`. */
  readonly actor?: string;
}

export interface Invitation {
  // … as today: `sender` is the home's sender, an organization's name and verifier on its home …
  readonly sender: {
    readonly name?: string;
    readonly verifiedBy?: string;
    /** On an organization's home: the member responsible for the page, while they are a member. */
    readonly member?: { readonly name?: string; readonly verifiedBy?: string };
  };
}

export interface LinkPolicy extends Cacheable {
  // … as today …
  /** On an organization's page: `false` hides the member under the organization's name. Absent: shown. */
  readonly showMember?: boolean;
}

export interface AuthenticatedCredential {
  // … as today …
  /**
   * The home the credential acts on, when it isn't `account`'s own: an organization's home that
   * `account` is a member of. The server checks the membership at every use.
   */
  readonly home?: string;
}

export interface ServerHandle {
  // … as today …
  /**
   * Makes an organization's account and the hosted home it owns, or updates its name, handle and
   * verifier. Idempotent by `account`. Refused for an account a person signs in as, and for a
   * handle another home holds.
   */
  setOrganization(org: OrganizationHome): Promise<{ readonly home: string }>;
  /** Replaces a home's whole member list. Whoever it omits is removed, as by `removeMember`. */
  setMembers(home: string, members: readonly HomeMember[]): Promise<void>;
  /** Adds a member, or changes their role. */
  setMember(home: string, member: HomeMember): Promise<void>;
  /**
   * Removes a member. When it resolves, their grants on the home are revoked and their bindings to
   * it are closed. Their artifacts stay hosted and wait for an adopter.
   */
  removeMember(home: string, account: string): Promise<void>;
  /** The home's members now. */
  members(home: string): Promise<readonly HomeMember[]>;
  /**
   * Gives a home to another account that owns none: a person's home to an organization (the person
   * becomes an admin member), or back to a person who is its only member. No route, label, link,
   * draft or submission changes. The person's machines keep their links; their chat-host grants on
   * the home are revoked, to be approved again.
   */
  transferHome(home: string, toAccount: string): Promise<void>;
  /** The instances linked to a home. */
  instanceLinks(home: string): Promise<readonly InstanceLinkInfo[]>;
  /**
   * Revokes one linked instance: its grants are revoked and its binding closed. The artifacts it
   * owns stay hosted and wait for an adopter, or for the same machine to be linked again.
   */
  revokeInstanceLink(linkId: string): Promise<void>;
}
```

What does not change: `OPERATOR_REVISION`, every time limit, `AccountResolution`, `LinkQuery`, `RoutingAnswer`, `AbuseReport`, `MeterBatch`.

### 5.2 The host protocol, additive within its revisions

**On a hosted home** (additive to INTERFACES §18.2):

```text
mostra/initialize   → InstanceInfo gains  owner?: { account, kind: "person" | "organization", name?, handle? }
                                           role?:  "member" | "admin"
artifact/list, artifact/get
                    → each artifact gains  hosted?: { routeId, owner: InstanceLink, access: "organization" | "private", released?: boolean }
hosted/links        {} → { links: InstanceLink[] }                       (read)
hosted/link.revoke  { instanceId } → {}                                  (its own account, or an admin)
artifact/access     { artifact, access: "organization" | "private" } → { access }   (manage)
artifact/release    { artifact, released: boolean } → { released }       (manage)
hosted/adopt.begin  { artifactId } → { routeId, owner: InstanceLink, versions: { versionId, number, outputDigest }[] }
hosted/version      { artifactId, versionId } → VersionPush              (only between begin and commit, and for the owner link)
hosted/adopt.commit { artifactId, from: string } → { routeId, deliveries: number, runs: { moved: number, left: number } }
hosted/submission   { submissionId } → SubmissionEnvelope                (the route's owner link, and its adopter between begin and commit)

GET https://api.example/files/<sha256>      the bytes of a client file this home holds; the binding's bearer token;
                                            404 for a file the home doesn't hold, whatever the server stores
```

`InstanceLink` is `{ instanceId, name, account?: { id, name? }, default, connected, linkedAt, revokedAt? }`.

**On the owner's own instance** (additive to INTERFACES §18.2 and §6):

```text
remote/login        { server?, org?: string | true, default?, requestId? }      org: a handle or home ID; true: choose on the page
remote/login.wait   → adds  home: RemoteHome
remote/link         → adds  home: RemoteHome
remote/logout       { server?, org?, personal?, forget? }
remote/status       → RemoteLink gains  home: RemoteHome                         one RemoteLink per server and home
remote/instances    { server?, org? } → { links: InstanceLink[] }
remote/instance.revoke { server?, org?, instanceId } → {}
remote/adopt        { artifact, server?, org?, requestId? }
                    → { artifactId, routeId, from: InstanceLink,
                        versions: { held: number, fetched: number }, submissions: number,
                        deliveries: number, runs: { moved: number, left: number } }
share/start         { …, via: "remote", server?, org?, personal?, access? }  → Share gains  home: RemoteHome
artifact/access     { artifact, access, hosted? }
share/stop          { …, moved?: boolean }
artifact/release    { artifact, released?: boolean, hosted? }
wait, results/get, results/list, events/read, artifact/list, artifact/get
                    { …, hosted?: { server?, org? } }       with it: answered by that hosted home, owned here or not
state/get, state/patch, live/push, roster/*, artifact/pause
                    { …, hosted?: { server?, org? } }       names one home when the artifact is hosted on several
```

`RemoteHome` is `{ id, kind: "personal" | "organization", name?, handle?, role? }`.

**Sign-in** (additive to INTERFACES §18.5):

- `POST /oauth/device` takes `mostra_home` (a handle or home ID), or `mostra_home_choose=1`. The device page names the home and the person. Approval is refused when the person is not a member.
- The token answer adds `mostra_home_kind`, `mostra_home_name`, `mostra_home_handle` and `mostra_role` beside `mostra_home`.
- `POST /link` answers `home: RemoteHome` too.
- `/oauth/authorize`: the consent page carries the home choice (4.7). The code, and the grant made from it, carry `home_id`.

### 5.3 Sessions and the one check

A session on a hosted home carries `{ accountId, homeId, grantId, linkId?, role }`. `role` is `admin` when `accountId` is the owning account, else the member's role. It is read from `home_member` at every check, a local indexed read, so a role change and a removal take effect on the next call of an open session, not at its next recheck. One function decides everything:

```ts
/** Whether a session may do this to this artifact of its home (INTERFACES §18.10). */
function may(session: Session, artifactId: string | undefined, right: "read" | "manage" | "run" | "adopt"): boolean
```

A table maps each method to its right. A handler never checks a role itself.

### 5.4 Tables and migrations

**The server's directory, migration 7 (WP-33).**

```sql
ALTER TABLE account ADD COLUMN kind TEXT NOT NULL DEFAULT 'person'
  CHECK (kind IN ('person', 'organization'));
ALTER TABLE home ADD COLUMN handle TEXT;                       -- NULL for a person's home
CREATE UNIQUE INDEX home_handle ON home(handle) WHERE handle IS NOT NULL;
ALTER TABLE home ADD COLUMN verified_by TEXT;                  -- the organization name's verifier
ALTER TABLE home ADD COLUMN verified_recorded_at TEXT;

CREATE TABLE home_member (
  home_id TEXT NOT NULL REFERENCES home(id),
  account_id TEXT NOT NULL REFERENCES account(id),
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (home_id, account_id)
);
CREATE INDEX home_member_account ON home_member(account_id);
-- Only an organization's home has members, and a member is a person.
CREATE TRIGGER home_member_home BEFORE INSERT ON home_member
  WHEN (SELECT a.kind FROM home h JOIN account a ON a.id = h.owner_account_id
         WHERE h.id = NEW.home_id) IS NOT 'organization'
BEGIN SELECT RAISE(ABORT, 'only an organization''s home has members'); END;
CREATE TRIGGER home_member_person BEFORE INSERT ON home_member
  WHEN (SELECT kind FROM account WHERE id = NEW.account_id) IS NOT 'person'
BEGIN SELECT RAISE(ABORT, 'a member is a person''s account'); END;
-- An organization's account signs in nowhere.
CREATE TRIGGER identity_person BEFORE INSERT ON identity
  WHEN (SELECT kind FROM account WHERE id = NEW.account_id) IS NOT 'person'
BEGIN SELECT RAISE(ABORT, 'an organization has no sign-in identity'); END;
-- An account's kind never changes.
CREATE TRIGGER account_kind_fixed BEFORE UPDATE OF kind ON account
  WHEN NEW.kind IS NOT OLD.kind
BEGIN SELECT RAISE(ABORT, 'an account''s kind never changes'); END;

ALTER TABLE "grant" ADD COLUMN home_id TEXT REFERENCES home(id);   -- NULL: the account's own home
ALTER TABLE consent ADD COLUMN home_id TEXT;                        -- the home last chosen for this client

DROP INDEX instance_link_default;                                   -- was: one default per account
CREATE UNIQUE INDEX instance_link_default ON instance_link(account_id, home_id) WHERE is_default = 1;

ALTER TABLE artifact_route ADD COLUMN access TEXT NOT NULL DEFAULT 'organization'
  CHECK (access IN ('organization', 'private'));               -- who among the members reads it
```

- **Existing rows:** every account is a `person`; every grant has `home_id` NULL and acts on its account's own home as before; every default link stays the default of its account and home; every route is `organization`, which on a person's home means what it always did.
- `instance_link.revoked_at` exists and is never set today (`server/auth.ts:441` only clears it). `revokeInstanceLink` and `hosted/link.revoke` set it; a sign-in from the same machine, approved again, clears it.
- `instance_link.account_id` is the person whose machine it is, on personal and organization homes alike. `linkFor` rebinds a link only for the same account **and the same home** (today: the same account, `server/auth.ts:439`).
- `credential_link` is unchanged: one link per key subject.

**The server's directory, migration 8 (WP-35).**

```sql
ALTER TABLE artifact_route ADD COLUMN adopting_json TEXT;   -- the plan of a commit in progress: { from, to, by, at }
ALTER TABLE artifact_route ADD COLUMN released_at TEXT;     -- its owner let any member adopt it
```

A route with `adopting_json` takes no push and sends no delivery or run until the commit finishes, as a route with `removing_json` serves nothing.

**A hosted home's ledger.** No migration. `delivery_terminal` refuses a change of a delivery's `port_owner` (`ledger/migrations.ts:338-343`), and it stays: adoption rewrites no delivery, because a hosted home's outbox sends each pending delivery to its artifact's owner link as the route names it then (4.5). A delivery's `port_owner` on a hosted home is therefore the link that owned the route when the submission was committed. The adoption commit updates `relay_run.owner_link_id` and `relay_seq` of never-sent runs, which no trigger guards. The new events are rows of the existing `event` table.

**The owner's ledger, migration 18 (WP-34).** `remote_link` is rebuilt with a local key, and its children reference the key.

```sql
remote_link(id PK,                       -- local: rl_ + ULID
            server NOT NULL, home_id NULL, home_kind NOT NULL DEFAULT 'personal'
              CHECK (home_kind IN ('personal', 'organization')),
            home_name NULL, home_handle NULL, role NULL,
            account_id, account_name, instance_id, is_default, linked_at, state,
            incarnation NULL, follow_cursor NULL, relay_mark INTEGER NOT NULL DEFAULT 0)
UNIQUE INDEX remote_link_personal ON remote_link(server) WHERE home_kind = 'personal'
UNIQUE INDEX remote_link_home     ON remote_link(server, home_id) WHERE home_id IS NOT NULL
hosted_artifact(artifact_id FK, link_id FK, server, hosted_home, route_id, label, token_id, url_secret_hint,
                shared_at, stopped_at NULL, released_at NULL, PRIMARY KEY (artifact_id, link_id))
version_push(artifact_id, version_id, link_id FK, server, state, attempts, next_attempt_at, created_at, refusal,
             PRIMARY KEY (artifact_id, version_id, link_id))
remote_missing(link_id FK, submission_id, noted_at, PRIMARY KEY (link_id, submission_id))
relayed_run   gains link_id
```

- **Existing rows:** each `remote_link` row becomes its server's personal link with a fresh `id`; `home_id` is filled from that server's `hosted_artifact.hosted_home` when one is recorded, else at the next session from `mostra/initialize`. Child rows take their server's one link.
- `server` stays on the children because `origin`, `scope_key` and every message to a person name the server.
- Credentials: the personal link keeps `<home>/keys/remote/<server key>.json`; an organization link uses `<server key>.<home id>.json`, and the same for `.links.json` (mode 0600, never in the ledger, D44).

**The owner's ledger, migration 19 (WP-35).**

```sql
ALTER TABLE version ADD COLUMN code TEXT NOT NULL DEFAULT 'full' CHECK (code IN ('full', 'client'));
```

A `client` version is a copy fetched from a hosted home: its client build and records, never server code. It is never launched, never exported as a bundle, and `gc` treats it as referenced while its artifact is hosted. Set at insert; the version row stays immutable.

### 5.5 Events and diagnostics

**Durable events, for hosts** (DATA_MODEL §4, additive):

| Event | Where | Payload |
|---|---|---|
| `instance.linked` | hosted home (exists) | gains `account: { id, name? }` |
| `instance.revoked` | hosted home | `{ instanceId, by }` |
| `token.minted` | hosted home | `{ tokenId, by }`: who minted a link, never its secret. Hosts only, never pages |
| `artifact.access` | hosted home | `{ access, by }` |
| `artifact.released` | hosted home | `{ released, by }` |
| `artifact.adopted` | hosted home, and followed by the old and new owner | `{ routeId, from: { instanceId, account }, to: { instanceId, account }, by, deliveries, runs }` |
| `remote.adopted` | the adopter's own log | `{ server, home, artifactId, versions: { held, fetched }, submissions }` |

**Diagnostics** (each with its docs page; hints are prose for D149):

| Code | When |
|---|---|
| `MOSTRA_REMOTE_HOME_UNKNOWN` | A sign-in, share or read names a home this account can't act on, or none exists by that name |
| `MOSTRA_REMOTE_HOME_AMBIGUOUS` | A share or a forwarded call could go to several homes; the message lists them |
| `MOSTRA_REMOTE_NOT_MEMBER` | A token's grant names a home its account is no longer a member of (401 on `/host`, `/files` and `/mcp`; the binding's close reason) |
| `MOSTRA_REMOTE_ROLE_DENIED` | A manage call on a colleague's artifact, or an adoption the caller has no right to; names who can |
| `MOSTRA_REMOTE_ADOPT_CONFLICT` | The owner link changed since `adopt.begin`; names the new owner |
| `MOSTRA_REMOTE_VERSION_CLIENT_ONLY` | A relayed run or call of a version this instance holds without server code; names the instance that had it |

`MOSTRA_REMOTE_NOT_OWNER_INSTANCE` keeps its meaning and gains the hint "or adopt it".

---

## 6. Failure model and security review

### 6.1 Failure rows (for FAILURE_MODEL §11.5, "Organization homes")

FAILURE_MODEL §1's rules hold for all of them. "The home" is an organization's hosted home.

**Membership and sessions**

| Case | Behavior |
|---|---|
| A member is removed while their instance is connected | When `removeMember` resolves, the member row is gone, their grants on the home are revoked and their bindings to it are closed (4403, "membership ended"). Their instance's refresh answers `invalid_grant`, `remote/status` shows the link `signed-out` with why, and their links to other homes are untouched. The home's pages keep working |
| A member is removed in the middle of a push | A `hosted/push` round already answered stands: a version that completed is hosted, one that answered `missing` stays incomplete and invisible (FAILURE_MODEL §11.2). The next `PUT /files` or push round answers 401 `MOSTRA_REMOTE_NOT_MEMBER`. Files uploaded for the unfinished version stay held by the home until a removal frees them, as after any interrupted push |
| A member is removed while their machine runs a relayed run | The server sends `port/relay.cancel` for each run that link accepted and hasn't finished, then closes the binding. Each such run, and each run sent to it and not acknowledged, becomes `unknown` at once (`action.unknown`): its end can no longer be reported, and it may have taken effect. Runs never sent keep waiting for an adopter until their offline limit, then end `failed`, `owner-offline`, as for any absent owner |
| A member is removed while a delivery to them is in flight | The call fails with the connection. The delivery stays pending for the route's owner link, in order, and goes to whoever adopts the artifact. A delivery their machine committed before the close is `delivered` if its acknowledgement arrived; if it was lost, the adopter receives that submission too (the accepted boundary below) |
| A removed member is added again | They sign in again. Their machine's sign-in names its old link, which is rebound (same account, same home), so the artifacts it still owns are its own again. Reconciliation replaces each `unknown` run with the end their machine recorded, once (FAILURE_MODEL §11.1) |
| A member's role changes while they are connected | The next call is judged by the new role: the role is read at every check |
| The operator can't be reached | Membership is not asked of it, so every member keeps working and every removed person stays out. A removal the operator hasn't delivered yet is late by the operator's own delay. `limits` behaves as today: `share`, `version.push`, `link`, authoring and `adopt` fail closed with `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE`; views, answers and relayed actions proceed |
| The operator's call fails part-way (`setMembers` with fifty members) | Each handle call is one directory transaction: all of it or none. The call throws; the operator repeats it. `setMembers` is idempotent, so a repeat after an unknown outcome is safe |
| The server stops between a removal's commit and closing the bindings | A restart closes every binding. Tokens are judged against the member list at every request, so nothing reopens |
| `setOrganization` names an account a person signs in as, or a handle another home holds; `setMember` names an organization's account; `transferHome` names an account that owns a home | Refused with `MOSTRA_HOST_INVALID_PARAMS`, naming the field; nothing changes. The directory's triggers refuse the same rows if code ever tried |
| The organization's home is suspended (`suspendHome`) | As for any home (FAILURE_MODEL §11.3): its pages answer 403 `MOSTRA_REMOTE_HOME_SUSPENDED`, and its bindings, pushes, links and MCP calls are refused, for every member. Each member's own home, and their links to other organizations, are untouched |
| A member is suspended personally (`accounts.status`) while the organization is not | That person acts nowhere: their grants, refreshes and bindings are refused on their own home and on every organization's (403, the refresh token kept, D167 item 24), and come back when the suspension lifts. The organization's pages keep working. Their artifacts wait like an offline owner's, and an admin may adopt them |
| A person signs in with `--org acme` against a server that predates organization homes | That server ignores the field and would link the person's own home. The token answer then carries no `mostra_home_kind: "organization"`, so the instance revokes the grant it was just given, records no link, and fails with `MOSTRA_REMOTE_HOME_UNKNOWN`, saying the server has no organizations. Nothing is ever shared under the wrong sender |
| A device code started with `--org acme` is approved by someone who isn't a member | The device page refuses the approval and says so. No grant is made |
| A machine is linked to two homes on one server and one membership ends | That link signs out. The other link's connection, cursor, pushes and deliveries are separate and unaffected |
| `mostra share` on a machine linked to several homes, for an artifact hosted on none of them, without `--org` or `--personal` | `MOSTRA_REMOTE_HOME_AMBIGUOUS`, listing the homes. Nothing is pushed |

**Artifacts and their owners**

| Case | Behavior |
|---|---|
| Two members share the same new artifact ID into the home at once (both hold the project) | The directory mints one route in one transaction. The first push owns it; the second is refused with `MOSTRA_REMOTE_NOT_OWNER_INSTANCE`, naming the first's instance and saying it may be adopted. Neither is half-hosted |
| A member pushes a version of a colleague's artifact | Refused the same way, for good: the push is `refused` in `remote/status` and later publishes of the member's other artifacts still go out (FAILURE_MODEL §11.2) |
| A member asks for a `private` artifact that isn't theirs | It isn't listed for them, and `artifact/get`, `results` and `wait` answer as for an artifact the home doesn't host. Its owner member and admins read it as any other |
| An artifact is made `private` while a colleague waits on it | The colleague's wait ends at its next poll with the same answer as for an unknown artifact. Nothing more of it is sent to them |
| A member calls a manage method on a colleague's artifact | 403 `MOSTRA_REMOTE_ROLE_DENIED`, naming the owner member and that an admin can; nothing changes |
| The owner instance is gone for good (a lost laptop, a member who left) | Pages, drafts and answers keep working. Deliveries stay pending and runs wait or fail by their policy, as FAILURE_MODEL §11.2 already says. An admin, or the same person on another machine, adopts the artifact, and what was pending arrives there |
| A laptop is lost or stolen | Its owner from another machine, an admin, or the operator revokes that instance link. Its grants are revoked and its binding closed; it can't refresh. Its link ID stays the owner link of its routes until they are adopted. What the machine already holds can't be recalled: sources, versions, the secrets set on it and the answers it imported. The docs say to rotate those secrets |
| A member's home is restored from a backup | Per link, as today (FAILURE_MODEL §11.2): the follow resumes from the lower cursor, missing submissions are read again, and a relay mark below what the home saw makes that link's accepted runs `unknown`. Other members' links are other links and are untouched |
| A member's home is restored to before it adopted an artifact | The server says the link owns a route the local ledger doesn't know. On every session start the instance compares the routes its link owns with its `hosted_artifact` rows and prepares each missing one as an adoption does (versions, history), without a commit. Until that finishes, a delivery for it answers `retry: true`, never a final refusal |
| The hosted home is restored from a backup taken before an adoption | Its directory and ledger say the old link owns the route again. The adopter's cursor or relay mark is above the home's, so the home's incarnation rotates (FAILURE_MODEL §11.2). The adopter's pushes are refused as not the owner, which tells it, and it adopts again. The old owner, if it returns, is the owner until then |

**Adoption**

| Case | Behavior |
|---|---|
| Adoption is asked by someone with no right to it | `hosted/adopt.begin` answers `MOSTRA_REMOTE_ROLE_DENIED`, naming who can (an admin, the owner, or anyone once it is released). Nothing is fetched |
| Two instances adopt one artifact at once | Both may prepare. The commit is compare-and-set on the owner link each saw: the first wins, the second gets `MOSTRA_REMOTE_ADOPT_CONFLICT` naming the new owner, and keeps what it fetched |
| The adopter stops or loses its connection while preparing | Nothing changed on the server. Fetched versions and imported submissions are kept (each is idempotent by ID). The command is run again and continues |
| The server stops during the commit | The plan is in `artifact_route.adopting_json` before the home's ledger is touched. The next call for that route, or the home's next opening, finishes it. Meanwhile the route takes no push and sends no delivery or run. Pages and answers are unaffected |
| The old owner is connected and running when the commit happens | Runs it accepted stay its own and finish there; it reports their ends as today. It receives no new delivery or run for the artifact. It follows `artifact.adopted`, stops pushing the artifact, and keeps what it imported |
| The old owner had committed a delivery whose acknowledgement was lost just before the commit | The adopter receives that submission too. The hosted home has one delivery row, but two machines each told their own hosts once. Adoption's one accepted boundary |
| The old owner publishes during the commit | Its push lands before the commit, and the adopter fetches that version when it follows `version.published`; or it is refused after it. Never in between |
| A viewer presses an action of a version the adopter holds without server code | The run is relayed, and the adopter refuses it before running anything: it ends `failed`, reason `owner-refused`, with `MOSTRA_REMOTE_VERSION_CLIENT_ONLY` naming the instance that had the code. The page shows the failure. The adopter's next publish gives viewers a version whose actions run |
| A relayed run needs a secret the adopter hasn't set | It fails as on any machine without that secret, with the secret's name in the diagnostic and never its value (AC-06) |
| `limits` refuses `adopt`, or the operator doesn't answer | Refused before the commit with the operator's message, or `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE`. What the adopter prepared is kept |
| A forwarded `wait` or `results` when the server can't be reached | `MOSTRA_REMOTE_UNREACHABLE`. The caller repeats with its cursor. Nothing is read from the local ledger in its place, since this instance holds nothing of an artifact it doesn't own |
| The whole home is transferred to an organization while its owner's machines are connected | The sessions go on: the home is the same home. The person's machine grants now name it explicitly, their role is `admin`, and their instance learns the home's new kind at its next session. Their chat hosts' grants on it are revoked, and the next tool call asks them to connect again and choose. Existing links, drafts and answers are untouched. Signed-in viewers are told the new sender before they are next named to it |

### 6.2 Security review: what shared ownership adds

| Threat | What holds |
|---|---|
| **A removed member's cached tokens.** An access token good for an hour, a refresh token good for ninety days, an open binding, a chat host's token | Every request re-reads the member row for the token's home; a token whose account is no longer a member is refused at once, whatever its expiry. The grants are revoked in the removal's transaction and the bindings closed before it resolves. Bound: when the call resolves, and within the binding recheck in any case. A seeded test removes the row check and expects red |
| **The links a removed member holds.** They minted them, so they have the URLs | A capability URL is the authorization (D06, invariant 2). A removed member with a link is a link holder: they can open the page and answer as any holder can, and see nothing a respondent can't. They are no longer "the owner" on that page. An admin revokes or rotates the links of a page they worry about (`view/revoke`, `view/rotate`), and an operator can (`revokeLinks`) |
| **Personal links a removed member minted for named respondents.** Holding Dee's personal link lets them answer as Dee | True of whoever mints a personal link today. Rotation keeps the respondent and replaces the secret (D97 item 6), and `roster/add` again relinks. Today nothing records who minted a link: only `token.revoked` is an event (`gateway/capabilities.ts:495`). This design adds a durable `token.minted` event for hosts that names the member, so an admin finds what a person minted. *Left for later:* "revoke everything this member minted" as one call |
| **What is already on their machine.** Sources, versions, their own secrets, and every answer delivered to them | It can't be recalled, as nothing delivered to any host can. It is the cost of running a page on a member's machine. An organization that can't accept it shares from an always-on instance of its own and gives members read access only (an operator's `limits` by `actor`) |
| **A curious or malicious member reads colleagues' results** | Every member reads the home's `organization` artifacts, by design (4.3). A page not everyone should read is shared `private`, and then only its owner member and admins read it, and nobody else learns it exists. Finer walls (named readers, groups) are two organizations, or `ee/`'s access lists on the one check |
| **A malicious member publishes a harmful page under the organization's verified name** | The sender line names the member under the organization, unless the operator's own policy hides it. The operator's `abuse.pushed` and `limits` see `actor` either way. An admin pauses the page and manages its links; the operator quarantines and removes. This is the abuse path of any account, with a better name on it, which is why the member is shown |
| **A member replaces what a colleague's respondents see** | Impossible without adoption: only the owner link pushes. Adoption needs an admin, the owner's release, or the same person |
| **A member redirects a colleague's answers or actions to their own machine** | The same: deliveries and runs follow the owner link, which changes only by adoption, an event every member's host and the operator see |
| **Privilege escalation through roles** | No protocol method writes `home_member`, the owning account or a handle: only the operator's handle does. Roles are a closed set checked by schema. Every method's right comes from one table; a method missing from it is refused, and a test lists every method the hosted home serves against the table |
| **Adoption as a way to reach secrets or server code** | Secrets never leave a machine (D117), and server code never reaches the server (D165 item 3), so adoption can fetch neither. A fetched version is a client build, which every link holder's browser already loads |
| **`GET /files/<sha256>`** opens a read on the file store | Only a file the token's home holds, by the home's own `home_file` rows, with the binding's audience. It tells one home nothing of another's files, as the upload rules already ensure (RM-03) |
| **Cross-organization confusion for a person in several.** The wrong sender on a share, an agent acting in the wrong home, a token used across homes | One grant names one home, and the server derives the home from the grant, never from a parameter. The device and consent pages name the home in their heading. A share with several possible homes must name one. `mostra status`, a share's answer and `artifact_list` name the home. Credentials are kept per server and home. A link is rebound only for the same account and home |
| **A chat-host agent acting for a person reaches further than the person meant** | Its token's grant names the one home chosen at consent. It has that person's rights there and nothing in their other homes |
| **Device-code phishing with a higher prize.** An attacker starts `mostra login --org acme` and gets a member to approve it | The page says whose pages the machine is linked to and that the person should continue only if they started it there (D165, the Opus review's P1). Every link raises `instance.linked` with its account, shows in `hosted/links` and the handle's `instanceLinks`, and can be revoked by its account, an admin or the operator. *Residual:* a member who approves anyway links the attacker's machine as themselves. It gains that member's rights, not an admin's |
| **Guessing which organizations exist** | A handle that names nothing and one the person isn't a member of get the same answer |
| **A spoofed sender.** "Sent by Acme" from someone who isn't Acme | Only the operator sets an organization's name and verifier. Without a verifier the line says "name not verified". The member line shows only a current member. Everything is text in the trusted chrome (invariant 7) |
| **`transferHome` changes the sender under links people already hold** | Only the operator can do it. Signed-in viewers are shown the new sender before they are named to it again (`sender_shown` is cleared for the home) |
| **An operator-issued key that names a home** | The server checks the key's account against the home's member list at every use, as for a grant. A key can't name a home its account isn't a member of |
| **Secrets on members' machines.** One API key now set on five laptops | Each machine holds its own secrets and adoption moves none. Removing a member can't unset a secret on their laptop. The docs say: rotate what a leaver's pages used, and keep shared production secrets on the organization's own instance |
| **One member exhausts the organization's allowance** | `limits` carries `actor`, so the operator bounds a member, not only the home |
| **Every member's laptop receiving every page's traffic** | The follow of a link carries only the events of the routes it owns, filtered on the server |

---

## 7. Verification and requirements

### 7.1 How the checks run

As WP-30's and MT-03's suites: a real `mostra-runtime server` on loopback with the development identity provider, loading the fixture operator module `packages/runtime/test/fixtures/operator.mjs`, which gains a control file the test writes to drive `setOrganization`, `setMembers`, `removeMember`, `transferHome` and `revokeInstanceLink` through the real handle. Two to four real owner daemons, each its own home directory, signed in through the real device page as different people. Pages through the real front and gateway in Playwright. Every seeded violation is planted with `prove-seeds.ts`, red when planted and green when restored. WP-33 has no owner-side `--org` yet, so its suites link each member's instance with an operator-issued key that names the home (`remote/link`) and drive the device grant with `mostra_home` over HTTP. WP-34 repeats the same cases through `remote/login { org }`.

### 7.2 The checks, by suite

**`org-home.test.ts` (integration; RM-10, HO-12).**
1. The module names Acme and its members. Ada and Bo each run `remote/login { org: "acme" }`, approve on the device page, and `remote/status` shows two links each (personal and Acme) with roles. A person who isn't a member is refused on the page, and `remote/login { org: "nope" }` gets the same `MOSTRA_REMOTE_HOME_UNKNOWN` as a real handle they aren't in.
2. Bo shares into Acme. The route is in Acme's home, his personal home has none, and Ada's `artifact/list { hosted: { org: "acme" } }` shows it with Bo's instance as owner.
3. `removeMember(bo)`: within one second his binding to Acme is closed with `membership ended`; his access token on `/host`, `/files` and `/mcp` answers 401 `MOSTRA_REMOTE_NOT_MEMBER`; his refresh answers `invalid_grant`; his personal link stays connected and still pushes. The page he shared still serves, takes a submission, and its delivery stays pending.
4. Removal mid-run: a relayed run blocked on Bo's machine becomes `unknown` at the removal; a run never sent stays `waiting`.
5. With the operator module hanging on every port, members share nothing new (`limits` fails closed, as today) but stay connected, read, and receive deliveries.
6. With no operator module: `remote/login { org }` is `MOSTRA_REMOTE_HOME_UNKNOWN`, the directory has no organization account, and WP-29's and WP-30's suites pass unchanged.
7. `suspendHome(acme)` refuses Acme's pages and bindings and leaves both members' personal homes working. `accounts.status(bo) = suspended` closes Bo's bindings on both homes and leaves Acme's pages and Ada working.

*Seeds:* the member row not re-read at `authenticate`; grants not revoked on removal; bindings not closed on removal; `linkFor` rebinding across homes; the device page approving a non-member; a `NULL` `grant.home_id` resolved to an organization's home.

**`org-roles.test.ts` (integration; RM-12, owned by WP-33).**
1. A table test: every method the hosted home's protocol server registers is in the method-to-right table (the test reads the server's handler list), and for each right a member on a colleague's artifact, a member on their own, and an admin get the table's answer.
2. Bo's push to Ada's route is `MOSTRA_REMOTE_NOT_OWNER_INSTANCE` naming her instance; his `view/url`, `roster/add`, `state/patch` and `artifact/pause` on it are `MOSTRA_REMOTE_ROLE_DENIED`; his `results/get` and `wait` succeed.
3. A role change from `admin` to `member` takes effect on the next call of an open binding.
4. Bo's binding trace (`MOSTRA_TEST_BINDING_TRACE`) contains no event of Ada's artifact while she receives submissions.
5. Ada shares an artifact as `private`. Bo's `artifact/list` doesn't contain it, and his `artifact/get`, `results/get` and `wait` on it answer exactly as for an artifact ID the home doesn't host. Cy, an admin, reads it. Opened through its link while signed in, Bo sees a `private` team form as a respondent does and Cy sees everyone. Ada sets it back to `organization` and Bo reads it.

*Seeds:* a manage method mapped to read; the owner-account test replaced by "any member"; the role cached at session open; the follow's server-side filter removed; `private` ignored by `artifact/list`; a private artifact answering a different code than an unknown one.

**`org-operator.test.ts` (integration; HO-12).**
1. Every `limits` query from Bo's share, push, link and MCP call names `account` Acme's and `actor` Bo's; a view and a submit carry no `actor`.
2. Metering: `mcp.calls`, `bytes.stored` and `relay.messages` carry `actor`; `views`, `submissions` and `bytes.held` name Acme's account with none.
3. `version.pushed` carries `actor`. `abuse.pushed` carries `actor`.
4. `setMembers` replaces the list in one transaction (a list with a bad entry changes nothing); `members` reads it back; a repeat is a no-op.
5. `instanceLinks` lists both members' machines; `revokeInstanceLink` closes that machine's binding and refuses its refresh, and the same machine signing in again rebinds the same link.
6. An operator-issued key answering `{ account: bo, home: acme }` opens a binding on Acme's home as Bo, and stops when Bo is removed. A key for Acme's own account links an instance with every right.
7. `transferHome(ada's home, org)`: every link Ada minted still opens, her routes and labels are unchanged, her binding stays open, the sender line now names the organization, her chat host's token is refused until she connects again, and her next personal sign-in makes a new home.

*Seeds:* `actor` dropped from `limits`; `account` set to the actor's; `setMembers` applied row by row outside a transaction; a key's `home` not checked against the member list; chat-host grants kept across a transfer.

**`org-link.test.ts` (integration; RM-11, owned by WP-34).**
1. The owner's ledger migration: a home from the released version with one link, two hosted artifacts and a pending push upgrades; its link is the personal link, its artifacts keep their routes, and the pending push goes out.
2. One instance, two links on one server: each has its own connection, cursor and relay mark; stopping one leaves the other.
3. The share rule: one link, no flag; two links and an artifact already hosted on one; two links and a new artifact (`MOSTRA_REMOTE_HOME_AMBIGUOUS`); `--personal`.
4. One artifact shared to the personal home and to Acme: two routes, two labels, submissions of both imported with their own origins.
5. Against a server build from before WP-33 (the released image): `remote/login { org }` fails with `MOSTRA_REMOTE_HOME_UNKNOWN`, and the server's directory holds no live grant from the attempt.
6. `org-home.test.ts`'s cases 1 to 4 and 7 again, with every instance signed in through `remote/login { org }` on the real device page.

*Seeds:* the ambiguity rule falling back to the first link; `hosted_artifact` keyed by server again; the personal link's uniqueness dropped; the downgrade guard removed.

**`org-mcp.test.ts` (integration; MC-05).**
1. A member's authorization shows the home choice; choosing Acme makes a grant whose calls list Acme's artifacts and none of the person's own. A person with no membership sees today's page.
2. Authoring goes to the member's default instance on Acme's home, and with none connected answers `MOSTRA_REMOTE_NO_INSTANCE` while reading still works.
3. After `removeMember`, the chat host's next call is 401, and its refresh is refused.

*Seeds:* the grant's home ignored at `/mcp`; authoring sent to the home's default link of another member.

**`org-sender.spec.ts` (e2e, three browsers; HY-10).**
1. A page in Acme's home shows the organization with its recorded verifier and the member under it; with no verifier, "name not verified"; after the member is removed, the organization alone; after adoption, the adopter; with the operator's policy answering `showMember: false`, the organization alone.
2. The artifact can't render over, restyle or hide either line (WP-30's attempts, reused).
3. A name carrying markup is shown as text.
4. A signed-in member opening a `private` team form of their organization sees every respondent; after removal, at the next request, only themselves.

*Seeds:* the member line shown for a removed member; the organization's verifier read from the member's identity.

**`adopt.test.ts` and `remote-read.test.ts` (integration; RM-14 and RM-13, owned by WP-35).**
0. Before any adoption: with deliveries following the route, WP-29's hosted, relay and restore suites pass unchanged, and a submission's delivery row still names the link that owned the route at commit.
1. Bo shares a page with an action and a submission pending while his daemon is stopped. Ada (an admin) adopts with the same source: versions held, the pending delivery arrives on her machine, her local host is woken once, a waiting run runs on her machine once.
2. Ada adopts without the source: the version is fetched client-only, the submission imports and renders in `results`, and pressing the action ends `failed` with `MOSTRA_REMOTE_VERSION_CLIENT_ONLY`. After her publish from source the action runs.
3. Cy (a member) can't adopt Bo's page, can after `artifact/release`, and can adopt her own page on a second machine with no release.
4. Two adopters race: one commits, the other gets `MOSTRA_REMOTE_ADOPT_CONFLICT` naming the winner.
5. The fault point `adopt:after-plan` (`MOSTRA_TEST_FAULTS`) stops the server mid-commit; after a restart the commit is finished, every pending delivery arrived once, and no run ran twice (the counting fake mail server).
6. The old owner returns after the adoption: it receives nothing new, its accepted run reports its end, and its next publish is refused as not the owner.
7. Remote reads: Cy's `results/get`, `results/list`, `wait { until: "submitted:all" }` and `artifact/list` with `hosted` answer from the hosted home for an artifact her instance doesn't hold; with the server stopped they answer `MOSTRA_REMOTE_UNREACHABLE`.

*Seeds:* the commit without compare-and-set; delivered submissions enqueued to local hosts again at import; sent runs moved to the new link; the plan written after the ledger; a client-only version launched; a delivery row's owner rewritten; the outbox sending by the stored owner after an adoption.

**The conformance kit (HO-05, extended).** One scenario, `remote.organization`: the kit's server loads its own small operator module naming an organization with the host's signed-in person as a member; the host signs in with `remote/login { org }`, shares, and receives the delivery. It needs nothing beyond `harness/call`, so both reference hosts take it.

**External evidence.** A chat host choosing an organization's home on the consent page of a deployed server, labelled external.

### 7.3 New requirement rows (REQUIREMENTS.md, "Remote readiness, remote server and relay" and neighbours)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RM-10 | A hosted home may belong to an organization: an account of its own kind, whose home people act on as members with a role that only the operator's handle sets. Every session acts on the one home its grant names. A removed member's tokens, bindings and chat-host access stop when the removal resolves, while their pages keep serving. With no operator module there are no organizations and nothing else changes | v1.1 | D170 | I |
| RM-11 | An owner instance links to several homes on one server, each link with its own grant, connection, cursor and relay mark. Sign-in, sharing and reads name the home, and nothing is shared into an organization's home by a default the person didn't see | v1.1 | D170 | I, C |
| RM-12 | In an organization's home one check decides every call: every member reads every artifact, except one shared as private, which only its owner member and admins read and which is listed for no one else; links, the roster, pause and state writes belong to the owner member and admins; pushing versions and running relayed code stay the owner instance's alone | v1.1 | D170 | I, B |
| RM-13 | A member's instance reads and waits on an artifact of the home that it doesn't own, through the hosted home, from the CLI and the host protocol, and writes nothing of that artifact to its own ledger | v1.1 | D170 | I |
| RM-14 | Adoption moves a hosted artifact to another member's instance: the adopter takes the versions it holds or can import, fetches a client-only copy of the rest, imports the artifact's submissions, and receives its pending deliveries and unsent runs in order; each submission keeps its one delivery, no run runs twice, and a run the previous owner accepted and never finished ends outcome-unknown | v1.1 | D170 | I |
| HO-12 | The operator contract for organization homes, additive within its revision: the handle makes an organization and sets, reads and removes its members, transfers a home, and lists and revokes linked instances; queries, counters and events name the owning account and, where a member acted, the actor; a link policy may hide the member on the sender line | v1.1 | D170 | I, M |
| HY-10 | An organization's hosted page names the organization and who verified its name, and the member responsible for it while they are a member and unless the operator's policy hides them, as text in the trusted chrome; a name no one verified is labelled unverified | v1.1 | D161, D170 | B |
| MC-05 | A chat host's grant names one home, chosen on the authorization server's consent page; its reading tools see that home, and its authoring tools build on the member's own default instance there | v1.1 | D170 | I, X |

**Their concrete checks** (for `tools/design/evidence_matrix.py`'s `CHECKS`), in one line each:

- **RM-10:** `org-home.test.ts` cases 1 to 7 with their seeds.
- **RM-11:** `org-link.test.ts` cases 1 to 6, and the kit's `remote.organization` against both reference hosts.
- **RM-12:** `org-roles.test.ts` cases 1 to 5, and `org-sender.spec.ts` case 4.
- **RM-13:** `remote-read.test.ts` (`adopt.test.ts` case 7).
- **RM-14:** `adopt.test.ts` cases 0 to 6.
- **HO-12:** `org-operator.test.ts` cases 1 to 7; the operator API report shows only additions.
- **HY-10:** `org-sender.spec.ts` in Chromium, Firefox and WebKit.
- **MC-05:** `org-mcp.test.ts`, and the external check in a chat host.

Ownership: WP-33 owns RM-10, RM-12, HO-12, HY-10 and MC-05. WP-34 owns RM-11. WP-35 owns RM-13 and RM-14.

---

## 8. Scheduling and integration (the open repository)

This section gives the order and its product reasons.

### 8.1 The form: three packages

- **Not a maintenance unit.** A maintenance unit owns no requirement (D152). This adds eight.
- **Not part of an existing package.** None of WP-16 to WP-27 touches the server's directory, sign-in, the owner's link or the operator contract.
- **Three packages, each one session.** WORK_PACKAGES sizes a package for one fresh session, and the nearest package in breadth, WP-30, ran well past its day. So the work is cut where it has clean seams:
  - **WP-33, the server and the operator contract.** Complete and checkable by itself: an instance linked with an operator-issued key that names a home, and the device grant driven over HTTP, exercise every rule through public interfaces.
  - **WP-34, the owner's link and the CLI.** One instance on several homes, `--org`, the share rule. After it, a person uses organization homes end to end.
  - **WP-35, reading across members and adoption.** Depends on both and holds the one hard commit.
- **Numbers.** WP-33 to WP-35: the next free two-digit numbers (D125). WP-32 stays withdrawn (D146).

### 8.2 The place: after WP-27, before the terminal packages

| Option | For | Against |
|---|---|---|
| **After WP-27, first among the packages after the first release** (decided) | It is additive: nothing in v1's scope (D16, as amended) needs it. It builds on finished ground: WP-17 has changed the remote MCP surface, WP-20 has made the shell's design pass over the chrome the sender line lives in, WP-26's docs site exists to extend. It needs only MT-03's `main` | Its requirements take the release label `v1.1`, which so far meant the terminal modes |
| Between MT-03 and WP-16 | The server and the link are fresh in the dossier | Every v1 package moves back by three sessions. WP-17 and WP-20 would then change the consent page and the chrome under it |
| After WP-22 and WP-23 | Nothing | Terminals are independent of it, and organizations complete something the remote design already names (ARCHITECTURE §15.2: "and later an organization") |

**Dependencies.** WP-33 depends on WP-27 (the `main` that includes it); it extends WP-30's server and sign-in, WP-31's owner rule and MT-03's operator ports. WP-34 depends on WP-33 and extends WP-29's link. WP-35 depends on WP-34. WP-22 and WP-23 depend on none of them.

**Before the first release?** No. All three ship in minor releases after it, additively within the host protocol's revisions and `OPERATOR_REVISION` `2026-11-08` (invariant 10).

**Before WP-33 starts,** the session that records the decision adds D170 and the dossier text of section 10.2, so the package's required reading exists (D123).

### 8.3 Size and risk

| Package | Size | Why it fits one session |
|---|---|---|
| WP-33 | One session, plus its reviews | The directory, the authorization server's pages, one check over the hosted home's handlers, the handle and `actor`, the sender line. No owner-side change |
| WP-34 | One session, plus its reviews | One ledger migration, the link manager keyed by link, four commands, one conformance scenario. No server change beyond what its checks find |
| WP-35 | One session, plus its reviews | Forwarded reads are small. Adoption is one commit with a fault point, client-only versions, and history import |

| Risk | Checked early by |
|---|---|
| A handler outside the rights table would be open to every member | The table test that reads the protocol server's own handler list (`org-roles.test.ts` case 1), written before any handler is wrapped (WP-33) |
| A token outliving a membership | The member row is read at every request; the seed that skips it is planted in WP-33's first slice |
| The sender line and the consent pages change surfaces a design pass owns | WP-33 runs after WP-20 and uses its components; the wording goes to Mirza as one batch (D149) |
| The owner's ledger migration re-keys `remote_link` and four child tables under live data | WP-34's first slice: a home written by the released version, with a link, hosted artifacts and a pending push, upgrades and keeps working (`org-link.test.ts` case 1) |
| A new CLI against an older server links the wrong home silently | The downgrade guard and its check against the released image (`org-link.test.ts` case 5), in WP-34's first slice |
| The adoption commit spans the directory and a home's ledger | Plan first, as `ServerHandle.remove` does, with the fault point `adopt:after-plan` (`adopt.test.ts` case 5). Deliveries are out of the commit altogether: they follow the route (4.5) |
| The outbox sends by a delivery's stored owner today: one queue per `port_owner` (`interaction/outbox.ts:150-154`, `225`) | WP-35's first slice makes a hosted home's outbox ask the route at send time, with the existing hosted and restore suites as its regression net, before adoption is built on it |
| Chat hosts may not show the authorization page again for a client they hold tokens for | The choice is made at first connection, which every host shows. The external check records what a second connection does |
| `@mostra/protocol`'s size budget (60 kB whole entry, D166 item 18) | size-limit in CI; the new schemas are small, and the budget is raised with the measurement if needed |
| Windows | All three keep the `windows-remote` legs green (D153) |

### 8.4 Entries for WORK_PACKAGES.md

Under "After the first release", before WP-22. The section's intro and "How the sequence was built" gain: 37 packages, 5 after the first release; "then WP-33 to WP-35 (organization homes, D170), then WP-22 and WP-23". The graph gains `W27-->W33-->W34-->W35` in the "After the first release" group.

```markdown
### WP-33. Organization homes I: the server and the operator contract
- **Owns:** RM-10, RM-12, HO-12, HY-10, MC-05.
- **Builds:** the server's side of homes an organization owns, as D170 and INTERFACES §18.10 design them:
  - the directory: organization accounts, a home's handle and verifier, the member list with its two roles, the home a grant names, a default instance per account and home, and an artifact's access setting;
  - sign-in for a home: the device grant and the authorization code grant carry the home, the device and consent pages name it, and every token is judged against the member list at every request;
  - the hosted home's one check: read for every member (an artifact shared as private only for its owner member and admins), manage for the owner member and admins, run for the owner link, applied to every handler from one table; a link's follow carries only the events of the routes it owns;
  - the operator contract, additively: the handle's `setOrganization`, `setMembers`, `setMember`, `removeMember`, `members`, `transferHome`, `instanceLinks` and `revokeInstanceLink`; `actor` on `limits` queries, counters and events; a credential that names a home; `policy.link`'s `showMember`;
  - linked instances listed and revoked on the hosted home (`hosted/links`, `hosted/link.revoke`), and who minted each link recorded as an event;
  - remote MCP: the home chosen on the consent page, authoring on the member's default instance of that home;
  - the hosted shell's sender line for an organization, the member under it, and "the owner" of a team page as whoever may read the artifact;
  - the self-hosting page's example operator module for one shared home (prose with Mirza, D149).
- **Depends on:** WP-27 (the `main` that includes it); it extends WP-30, WP-31 and MT-03.
- **Evidence:** RM-10's, RM-12's, HO-12's, HY-10's and MC-05's checks against a real `mostra-runtime server` with the fixture operator module, with real owner instances linked by operator-issued keys that name the home and the device grant driven over HTTP; every existing remote suite passing unchanged with no operator module; external evidence from a chat host choosing a home on a deployed server, labelled as external.

### WP-34. Organization homes II: the owner's link and the CLI
- **Owns:** RM-11.
- **Builds:**
  - one link per server and home on the owner instance: the ledger's migration, credentials per link, and a connection, cursor and relay mark per link;
  - `remote/login` with `org`, the guard against a server that predates organization homes, `remote/status` per link, `remote/instances` and revoking one;
  - the share rule that never guesses a home, and sharing an artifact as private;
  - the CLI: `login --org`, `logout --org|--personal|--instance`, `share --cloud --org|--personal|--private`, `access`, `status`;
  - the conformance scenario `remote.organization`;
  - the Skill and docs for sharing into an organization (prose with Mirza, D149).
- **Depends on:** WP-33; it extends WP-29.
- **Evidence:** RM-11's check: a home written by the released version upgrades with its link, hosted artifacts and pending push intact; one instance holds a personal link and an organization's on one server, each with its own connection; the share rule's four cases; sign-in with `org` against the released server image fails and leaves no grant; WP-33's membership and removal cases repeated through a person's own sign-in; the kit's scenario against both reference hosts.

### WP-35. Organization homes III: reading across members and adoption
- **Owns:** RM-13, RM-14.
- **Builds:**
  - reads through the hosted home: `wait`, `results`, `events` and `artifact/list` with `hosted`, for artifacts the instance doesn't own, and `mostra list|results|wait … --cloud --org`;
  - a hosted home's deliveries sent to their artifact's owner link as the route names it at send time;
  - `artifact/release` and `mostra release`;
  - adoption: `remote/adopt` and `mostra adopt`, the hosted home's `hosted/adopt.begin`, `hosted/version` and `hosted/adopt.commit`, client files by `GET /files/<sha256>`, client-only versions in the owner's registry, the import of an artifact's history, and the commit that moves unsent runs and the route's owner with its plan recorded first;
  - what a removal does to a link's accepted runs, and the old owner's side of `artifact.adopted`;
  - the `adopt` operation of `limits` and the `artifact.adopted` operator event;
  - docs for members who leave, lost machines and an organization's always-on instance.
- **Depends on:** WP-34.
- **Evidence:** RM-13's and RM-14's checks: reads from an instance that holds nothing of the artifact; a page adopted with and without its source, with a pending delivery and a waiting run arriving once; two adopters racing; a server stopped mid-commit and finished after its restart; the previous owner returning.
```

### 8.5 `DETAIL` entries for `tools/design/wp_specs.py`

```python
"WP-33": dict(
  goal="A remote server hosts a home that an organization owns: people act on it as members with a role the operator sets, each session on exactly the home its grant names, under one sender, and a member who is removed is out when the operator says so.",
  reading=["../DECISIONS.md D06, D104, D105, D116 to D118, D159 to D161, D165 to D170", "../ARCHITECTURE.md §15 (all; §15.2, §15.3 and §15.10 twice)", "../INTERFACES.md §6, §18 (all; §18.10 is this package's surface)", "../DATA_MODEL.md §7 (§7.6 is this package's)", "../FAILURE_MODEL.md §11 (§11.5 is this package's)", "../rounds/MT-03-ORGANIZATION-HOMES.md (the first sketch, superseded by D170)", "WP-30's, WP-31's and MT-03's progress reports", "../../agents/test-deployment.md"],
  detail=[
    "D170 designed this package's surface: INTERFACES §18.10, DATA_MODEL §7.6 and FAILURE_MODEL §11.5. Build them as written; settle finer shapes under D123 and record each additively there, and bring Mirza any place where the design is wrong or silent. Every change is additive within the host protocol's revisions and `OPERATOR_REVISION` `2026-11-08`.",
    "**No owner-side change here.** The owner's link keeps one link per server until WP-34. The checks link each member's instance with an operator-issued key that names the home (`remote/link`; `AuthenticatedCredential.home`), and drive the device grant with `mostra_home` over HTTP as the OAuth suite does.",
    "**The directory** (migration 7): `account.kind`, `home.handle`, the home's verifier, `home_member` with its triggers, `grant.home_id` (NULL is the account's own home), `consent.home_id`, the default instance per account and home, and `artifact_route.access`. Every existing row keeps its meaning.",
    "**One principal.** A session carries the actor's account, the home its grant names and the link. `authenticate` derives the home from the grant and re-reads the member row at every request; the binding's recheck does too. A grant's home is never taken from a request's parameter.",
    "**One check.** `may(session, artifactId, right)` with the rights read, manage, run and adopt, and one table from method to right. No handler tests a role. Write the test that reads the hosted protocol server's handler list against the table before wrapping any handler; a method missing from the table is refused. On a person's own home the actor is the owning account and has every right, so every existing suite passes unchanged.",
    "**Access.** An artifact is `organization` (the default) or `private`. A private one is read only by its owner member and admins, isn't listed for anyone else, and answers them as an artifact the home doesn't host. `artifact/access` changes it under manage.",
    "**The follow.** A link's event subscription carries only the events of the routes that link owns, filtered on the server; the owner keeps its own filter. Check it with the binding trace.",
    "**The handle** writes membership in one directory transaction per call; `removeMember` revokes the person's grants on the home in that transaction and closes their bindings before it resolves, as `suspendHome` closes a home's. `revokeInstanceLink` and `hosted/link.revoke` set `instance_link.revoked_at`, which nothing writes today, and a sign-in from the same machine clears it. `transferHome` rewrites the person's machine grants to name the home, revokes their chat-host grants on it, makes them an admin member and clears `sender_shown` for it.",
    "**`actor`** on `limits` queries a member causes (`share`, `version.push`, `storage`, `link`, `mcp.call`), on `mcp.calls`, `bytes.stored` and `relay.messages`, on `version.pushed` and `abuse.pushed`. `account` stays the owning account everywhere.",
    "**Pages.** The device page and the consent page name the home; the consent page carries the choice whenever the account has more than one home. The sender line: the organization and its recorded verifier, then the member whose account owns the route's owner link while they are a member, unless `policy.link` answers `showMember: false`. \"The owner\" of a team page (D168 item 8) is whoever has the read right on the artifact. All wording is prose for Mirza (D149).",
    "**Remote MCP:** the grant's home; authoring on the actor's default instance among their links to that home; reading tools on what the actor may read; `state_patch` and `live_push` under manage.",
    "**`token.minted`**: a durable event for hosts naming who minted each link, never its secret.",
    "**The fixture operator module** gains a control file that drives the handle, and the self-hosting page gains the same module as its example of one shared home from a file. No membership format, command or page is added to the core (D165 item 11).",
    "Refresh the test deployment with the candidate before the external chat-host check (D167 item 20).",
  ],
  out=["Several links per server on one instance, `--org` and the CLI (WP-34)", "Adoption, releasing an artifact, and reads of artifacts the instance doesn't own (WP-35)", "Moving one artifact between homes: it is shared again, or the whole home is transferred", "Administering organizations: invitations, seats, a console, directory sync and audit logs are an operator's or `ee/`'s", "Lists of named readers per artifact, and organization-wide policies", "An MCP endpoint per home, and revoking everything one member minted: additive later"],
  risks=["Every hosted handler passes through one check now: a method missing from the rights table must be refused, never open.", "A token outliving a membership is the failure that matters most: the member row is read at every request, and a seed that skips it must go red.", "The sender line and the consent pages are surfaces the shell's design pass owns: build on its components.", "Windows: keep the `windows-remote` legs green."],
  handoff="A server hosts organizations' homes with members, roles, private artifacts, one sender and immediate removal, reachable with operator-issued keys and from chat hosts. WP-34 gives a person's own machine a link to each of their homes.",
),
"WP-34": dict(
  goal="A person shares into their organization from the machine they work on: one instance linked to their own home and to each organization's, with every command saying which home it means and none guessing.",
  reading=["../DECISIONS.md D97, D165 (items 1 to 3, 15), D166 (items 5, 8, 11, 14, 22), D167 item 21, D170", "../ARCHITECTURE.md §15.3, §15.4", "../INTERFACES.md §9, §17, §18.2, §18.7, §18.10", "../DATA_MODEL.md §7.3, §7.6", "../FAILURE_MODEL.md §11.2, §11.5", "WP-29's and WP-33's progress reports"],
  detail=[
    "D170 designed this package's surface (INTERFACES §18.10's owner side and commands). Build it as written; settle finer shapes under D123 and record them additively.",
    "**First, the two things that can corrupt.** (1) The ledger's migration 18, which gives `remote_link` a local key and re-keys `hosted_artifact`, `version_push`, `remote_missing` and `relayed_run`: prove it on a home written by the released version, with a link, hosted artifacts and a pending push. (2) The downgrade guard: `remote/login` with `org` against a server from before WP-33 must fail with `MOSTRA_REMOTE_HOME_UNKNOWN` and revoke the grant it was given, checked against the released image.",
    "**One link per server and home:** its own grant, refresh token, link ID, connection, follow cursor and relay mark. Credentials per link beside the existing file (the personal link keeps its file name). A sign-in rebinds a link only for the same account and home. `remote/status` answers one entry per link with its home and role.",
    "**The share rule:** the home named; else the only link on that server; else the home the artifact is already hosted on there; else `MOSTRA_REMOTE_HOME_AMBIGUOUS`, listing the choices. Calls that act on a hosted artifact take `hosted: { server?, org? }` to name one home when it is hosted on several.",
    "**Commands** (INTERFACES §18.7): `login --org [<handle>]`, `logout --org|--personal|--instance`, `share --cloud --org|--personal|--private`, `access`, and `status` listing every link. `remote/instances` and `remote/instance.revoke` forward to WP-33's `hosted/links` and `hosted/link.revoke`. Help text is prose for Mirza (D149).",
    "Repeat WP-33's membership, removal and suspension cases with instances signed in through `remote/login { org }`, so each rule is proven through a person's own sign-in as well as a key.",
    "The conformance kit gains `remote.organization`: its server loads a small operator module naming an organization with the host's signed-in person as a member; the host signs in with `org`, shares and receives the delivery.",
  ],
  out=["Reads of artifacts the instance doesn't own, and adoption (WP-35)", "Any change to what the server decides: a defect found there is fixed with its own check and recorded"],
  risks=["The migration runs on every existing owner's ledger: it must be idempotent, keep every pending push, and leave a personal link exactly as it was.", "Nothing may ever be shared under an organization's name by a default: the ambiguity rule has a seed for each fallback."],
  handoff="A person links a machine to each of their homes and shares into the one they name. WP-35 lets members read each other's pages from the CLI and moves a page to another member's instance.",
),
"WP-35": dict(
  goal="A page in an organization's home outlives the machine and the person that shared it: any member who may read it does so from their own CLI, and another member's instance takes it over with its answers and its pending work.",
  reading=["../DECISIONS.md D89, D105, D117, D165 (items 1, 3, 4), D166 (items 3, 7, 12, 16, 20, 22), D170", "../ARCHITECTURE.md §15.3 to §15.5", "../INTERFACES.md §15 (the bundle), §18.2, §18.3, §18.10", "../DATA_MODEL.md §3 (`delivery` and its triggers), §7.2, §7.3, §7.6", "../FAILURE_MODEL.md §4, §11.1, §11.2, §11.5", "WP-29's, WP-33's and WP-34's progress reports"],
  detail=[
    "D170 designed this package's surface (INTERFACES §18.10's adoption and remote reads). Build it as written; settle finer shapes under D123 and record them additively.",
    "**First: deliveries follow the route.** On a hosted home the outbox sends a pending delivery to its artifact's owner link as the directory names it at send time, in position order per owner link. A delivery row keeps the link that owned the route at commit, and `delivery_terminal` is untouched: no delivery row is ever rewritten. `hosted/submission` answers the route's owner link. Land this with the existing hosted, relay and restore suites green before building adoption on it.",
    "**Reads through the hosted home.** `wait`, `results/get`, `results/list`, `events/read`, `artifact/list` and `artifact/get` take `hosted: { server?, org? }` and are then answered by that hosted home, owned here or not. Nothing of an artifact the instance doesn't own is written to its ledger. `MOSTRA_REMOTE_UNREACHABLE` when the server can't be reached.",
    "**Adoption is driven by the adopter** (`remote/adopt`): begin (the right, the owner link, the versions); versions (held already, or a client-only copy fetched with `hosted/version` and `GET /files/<sha256>` and checked against `outputDigest`); history (every submission by `hosted/submission`, the events from cursor 0, each once by its origin; a submission already delivered is imported without a local delivery); commit.",
    "**The commit** records its plan in `artifact_route.adopting_json` first, then waits out a delivery call in flight, then in the home's ledger moves never-sent runs to the new link (fresh relay sequences above its floor, the offline clocks kept) and appends `artifact.adopted`, leaving accepted and sent runs with the old link, then sets the route's owner link by compare-and-set. A commit cut off is finished by the next call or the home's next opening. Add the fault point `adopt:after-plan`.",
    "**Client-only versions** (`version.code = 'client'`): never launched, never exported as a bundle, kept by `gc` while the artifact is hosted. A relayed run of one is refused before anything runs (`owner-refused`, `MOSTRA_REMOTE_VERSION_CLIENT_ONLY`).",
    "**A removal's runs.** When a member is removed or an instance link revoked, the server cancels that link's accepted, unfinished runs best effort and marks them, and its sent and unacknowledged runs, `unknown` at once.",
    "**A restored adopter.** On every session start the instance compares the routes its link owns with its own rows and prepares each missing one as an adoption does; a delivery for it answers `retry: true` until then.",
    "**Who may adopt:** an admin, the owning account's own credential, the same person on another machine, and any member once the owner released the artifact (`artifact/release`).",
    "`limits` is asked for `adopt` and fails closed; the operator receives `artifact.adopted` with its actor.",
  ],
  out=["Moving an artifact between homes", "Moving secrets: each machine sets its own", "Delivering one submission to several instances", "Running a version's server code anywhere but an owner instance (v1.x, `SandboxPort`)"],
  risks=["No run may run twice across an adoption: only never-sent runs move, and the counting fake proves it.", "The accepted boundary (a delivery the old owner committed whose acknowledgement was lost just before the commit reaches both machines) must be the only one: state it in the progress report with its test.", "A client-only version must never reach a worker launcher: one place decides, and a seed that launches one must go red.", "The outbox change touches every hosted delivery: it lands first, alone, under the existing suites."],
  handoff="A member's departure or a lost machine strands nothing: an admin adopts the page and its pending work arrives. The terminal packages follow.",
),
```

---

## 9. The decisions

Mirza delegated every open question to the design session on 2026-11-12. Each is decided below, with the reason that settled it. The candidates and what each winner borrowed are in section 4. Five decisions go further than the first draft's recommendation; they are marked **changed**.

| # | Question | Decided |
|---|---|---|
| D-1 | What owns the home | An account of kind `organization` |
| D-2 | Where membership lives | In the server's directory, written only through the operator's handle |
| D-3 | Roles and rights | `member` and `admin`; one check; members read, the owner member and admins manage, the owner link runs. **Changed:** an artifact may be shared as `private` |
| D-4 | Who may adopt | Admins; a person for their own artifacts on another machine; any member once the owner released it |
| D-5 | Versions the adopter lacks | Fetched from the hosted home as client-only copies |
| D-6 | Moving between homes | Never one artifact. Share again, or the operator transfers the whole home. **Changed:** the transfer revokes chat-host grants |
| D-7 | Self-hosters | No organizations without an operator module; a documented example module |
| D-8 | The sender line | The organization, then the member. **Changed:** an operator's link policy may hide the member |
| D-9 | Chat hosts | The home is chosen on the consent page; one grant, one home |
| D-10 | Packages | **Changed:** three one-session packages, WP-33 to WP-35, after WP-27 and before WP-22 |
| D-11 | Words | "Organization", `--org <handle>`, roles `member` and `admin` |
| D-12 | Revoking a linked instance | By its own account, a home admin, or the operator |
| D-13 | How pending deliveries change hands (new) | **Changed:** they follow the route at send time; no delivery row is rewritten |

**D-1. An organization account.** A home has one owning account, unique (`server/directory.ts:33`), and every operator query keys by it. Giving that account a kind changes one column's domain and no published field's meaning. The alternatives either gave `account` two meanings in a published contract or left members unable to share from where they work.

**D-2. Membership in the directory, through the handle.** The open server already keeps operator-supplied state it judges locally (an account's standing, a host's home). A port on the request path would turn every operator outage into disconnected teams, and membership carried by sign-in would make a removal wait for a sign-in. The cost of the choice, drift after an operator's own failure, is repaired by one idempotent call.

**D-3. Two roles, one check, and `private`.** Members read by default because a shared home exists so colleagues see each other's answers. The first draft stopped there and left any wall to a second organization or to `ee/`. That is not safe enough as a default product: one salary survey shared into a fifty-person home would be readable by all fifty, and the person sharing it would have no way to prevent it. So an artifact has one of two access settings, `organization` or `private`. It costs one column and one branch of the one check, needs no administration, and the default keeps today's simple model. Admins always read, because an admin can adopt any page and a wall they could step over would only pretend. Lists of named readers stay out of the core.

**D-4. Who may adopt.** Adoption redirects a page's answers and actions to another machine and lets that machine publish what existing link holders see. So it is an admin's act, or the owner's gift (a release), or the same person's own move to a new machine, which must never need an admin.

**D-5. Client-only copies.** An import refuses a submission whose version the instance doesn't hold (`interaction/imports.ts:116-124`). When a laptop is lost its builds are gone, and without copies the adopter's hosts would never be woken for answers given to older versions. A copy that renders and can't run closes that, and it carries nothing the server didn't already serve to every link holder.

**D-6. No artifact moves between homes.** D165's rule that a label never moves is what keeps one tenant's origin, and the browser storage on it, from ever becoming another's. An exception "when the owner asks" would put a cross-ledger copy and a judgment call into the tenancy rule. Sharing again is honest about what changes (the links). The whole-home transfer serves the one case where links must survive, a person's account becoming a team, and it moves nothing because the home stays the same home. **Changed:** the transfer revokes the person's chat-host grants on that home. They were approved for "your own pages", and an agent must not find itself acting for an organization by a change it was never shown. The person's machines keep their links, since those links own the routes.

**D-7. Self-hosters.** The mechanism is complete in the open server. Its administration is not there at all, as D165 item 11 requires. An example module that reads a file gives a self-hoster a shared home by editing one file, and CI runs it as the test fixture.

**D-8. The sender line.** The organization first, with who vouches for its name, because that name is what a respondent weighs. The member second, because a named person is what makes it accountable. **Changed:** `policy.link` may answer `showMember: false`. Some organizations must not show staff names to the public, and without the switch they could not use an organization's home at all. The default stays shown, and the operator still learns who acted from `actor`. The wording in 4.8 stands as the draft; like all viewer-facing prose it is accepted with its package (D149).

**D-9. The consent page.** A chat host's directory lists one endpoint, so a choice at connection time is the only one that reaches every install. Tool parameters would change frozen schemas (D32) for a value the person already chose.

**D-10. Three packages.** **Changed** from two. A package is sized for one fresh session, and the first draft's WP-33 was honestly two. The cut between the server and the owner's link is clean: the server's rules are provable through operator-issued keys before any CLI exists, and the link's migration deserves a session that does nothing else. Three reviews of moderate size are also safer than one large one. The place is unchanged: after WP-27, because nothing in v1's scope needs it and three packages would otherwise move every v1 package. Their requirements take `v1.1`, which now means "after the first release".

**D-11. The words.** "Organization" is what people say and what an operating layer calls it. "Owner" is not a role name anywhere in this design: it stays the artifact's owner instance and the home's owning account.

**D-12. Revoking a linked instance.** Today nothing can do it but the machine itself: the only writes that revoke a grant take one of its own tokens, and nothing ever sets `instance_link.revoked_at` (`server/auth.ts:441`, `578`, `680`, `829`). A stolen laptop would keep its link for up to ninety days. The person, an admin and the operator can each revoke it, which also closes the gap for a person's own home.

**D-13. Deliveries follow the route.** The home ledger refuses any change of a delivery's owner (`delivery_terminal`, `ledger/migrations.ts:338-343`), and that rule protects invariant 4's neighbours: a delivery's identity never changes. Three ways to hand pending deliveries to an adopter were weighed: lift the trigger inside the commit, as a removal lifts the write-once triggers; close the old delivery and insert a second one; or have the hosted home's outbox send each pending delivery to its artifact's owner link as the route names it at that moment. The third wins. The route becomes the one place that says who owns an artifact (STANDARDS: one source of truth per invariant), no constraint is weakened, a submission keeps exactly one delivery row, and the adoption commit no longer touches deliveries at all. What it borrows from the first: order. An adopter's queue merges the adopted artifact's pending deliveries with its own by position.

**What stays open, and why it may.** Three things are deliberately later, each additive: an MCP endpoint per home, "revoke everything this member minted", and a home-wide default for `private`. None changes a shape decided here.

---

## 10. The decision and the dossier text

The entry recorded as D170, and the dossier changes it brought.

### 10.1 The decision entry

```markdown
## Organization homes

### D170. Homes an organization owns (M65)
*Status:* approved at M65, where Mirza delegated the design's open questions to the MT-03 design session (D169 item 9), which decided each as written below. It settles ARCHITECTURE §15.2's "and later an organization", fills INTERFACES §18.10, DATA_MODEL §7.6 and FAILURE_MODEL §11.5, and names the packages that build it. It *amends* D165 item 2 ("one connection per linked server" becomes one per linked server and home) and D165 item 1b (moving an artifact to another owner instance, "additive later", is built as adoption) and, for hosted homes, D105's delivery owner (a pending delivery goes to its artifact's owner link as its route names it when the delivery is sent); everything else is additive within the host protocol's revisions and `OPERATOR_REVISION` `2026-11-08`.

1. **An organization is an account of its own kind, and owns one hosted home.** `account.kind` is `person` or `organization`. An organization's account has no sign-in identity. A home still has exactly one owning account, so routes, labels, tenancy and every `account` an operator port carries keep their meaning. A person keeps their own home and may be a member of any number of organizations' homes.
2. **Members are kept by the server and written only through the operator's handle.** `home_member(home, account, role)` in the server's directory; `setOrganization`, `setMembers`, `setMember`, `removeMember` and `members` on the handle. Every check is local, so an operator that can't be reached changes nothing. The open server ships no way to administer organizations (D165 item 11): with no operator module there are none, and the self-hosting page shows a small module that names one shared home from a file.
3. **A grant names its home.** `grant.home_id`; absent, the account's own. A sign-in for a machine or a chat host names the home on the authorization server's own page, and every token is judged against the member list at every request. An owner instance holds one link per server and home, each its own grant, link ID, cursor, relay mark and connection.
4. **Two roles, one check.** `member` and `admin`. Every member reads every artifact of the home, except one shared as `private`, which only its owner member and admins read and which is not listed for anyone else. The member whose instance owns an artifact, and admins, manage it (links, the roster, pause, state writes, its access). Only the owner link pushes its versions, receives its deliveries and runs its relayed code. One function decides, from one table of method to right. Finer rules are an operator's, through `limits` with the actor, or `ee/`'s.
5. **One owner instance per artifact stays** (D165 item 1b). Other members read and wait through the hosted home. An organization's always-on instance is a link of its home whose credential is the organization account's.
6. **A link's follow carries only its own routes' events,** filtered on the server.
7. **Removal.** When `removeMember` resolves, the person's grants on the home are revoked and their bindings closed. Their artifacts stay hosted. Runs their machine accepted and never finished become `unknown`; pending deliveries and unsent runs wait for an adopter.
8. **Adoption.** A member's instance takes over a hosted artifact: it holds or imports the versions it can, fetches a client-only copy of the rest (never server code, which the server never had, D165 item 3), and imports the artifact's submissions. The server then moves never-sent runs to it and makes its link the route's owner, by a commit whose plan is recorded first. No delivery row is rewritten: a hosted home sends each pending delivery to its artifact's owner link as the route names it then, so a submission keeps its one delivery. Admins adopt anything; a person adopts their own artifacts on another machine; any member adopts what its owner released. Secrets never move (D117).
9. **No artifact moves between homes.** A label never moves (D165). A page enters another home by being shared there again, with new links, or the operator transfers a whole home to an account that owns none (`transferHome`), which re-issues nothing and revokes the person's chat-host grants on it.
10. **The sender line** (D161) of an organization's page names the organization, with the verifier the operator recorded for its name or "name not verified", and under it the member whose instance owns the page, while they are a member, unless the operator's link policy hides the member. "The owner" of a team page (D168 item 8) is whoever may read the artifact.
11. **Remote MCP.** The consent page carries the home choice; a grant acts on one home. Authoring goes to the member's default instance on that home (the default becomes per account and home).
12. **The operator contract.** `account` stays the owning account. `actor` names the member on what a member caused: `limits` queries, counters and events. A credential may name a home its account is a member of. `limits` gains `adopt`; events gain `artifact.adopted`; `policy.link` gains `showMember`.
13. **A linked instance can be revoked from elsewhere:** by its own account, by an admin of the home, and by the operator. Who minted each link is recorded as an event for hosts.
14. **Names.** "Organization", `--org <handle>`, the roles `member` and `admin`. A handle is a lower-case name unique on the server; one that names nothing and one the person can't act on answer alike. Nothing is shared into an organization's home by a default: a share that could go to several homes must name one.
15. **Packages.** WP-33 (the server and the operator contract), WP-34 (the owner's link and the CLI) and WP-35 (reading across members and adoption), after WP-27 and before WP-22, with the requirements RM-10 to RM-14, HO-12, HY-10 and MC-05, released as `v1.1`.

*Why:* a team that shares pages as one sender needs one home, one set of links and one name respondents can check, while each page's code and secrets stay on a machine its people control. *Source:* M65. *Rejected:* a home with no owning account; membership asked through a port, or carried by sign-in; lists of named readers per artifact in the core; every member's instance importing every answer; delivery to several instances; the last pusher owning a route; rewriting a delivery's owner, or a second delivery per submission; moving a route between homes; a tool parameter or an endpoint per home for chat hosts; a shared-homes key in the server's configuration.
```

### 10.2 Dossier changes the decision brings

| Document | Change |
|---|---|
| PRODUCT.md | Vocabulary: **Organization** ("an account no one signs in as, which owns a hosted home that its members share into"), **Member**, **Adoption**. "Hosted home" and "Owner instance" gain "of a person or an organization". A journey J15, "A team's page outlives its sharer", from J-B, J-C and J-G above |
| ARCHITECTURE.md §15 | §15.2 "One owner per home": a person or an organization, with members. §15.3: one link per server and home; the follow's filter; the default instance per home; deliveries following the route. §15.5: adoption. §15.8: the organization's sender line. §15.9: the home a chat host's grant names. §15.10: the handle's membership calls and `actor`. §15.11: no organizations without a module, and the example |
| INTERFACES.md | A new §18.10 "Organization homes" with sections 5.1 to 5.5 of this document; §18.7 gains the commands of 4.6; §9 the same |
| DATA_MODEL.md | A new §7.6 with 5.4's tables and migrations; §4's catalog gains 5.5's events; §3's note on `delivery.port_owner` for hosted homes |
| FAILURE_MODEL.md | A new §11.5 with 6.1's rows; §11.2's "The owner instance is gone for good" row points to adoption |
| REQUIREMENTS.md | The eight rows of 7.3; the release note says `v1.1` covers the packages after the first release |
| WORK_PACKAGES.md, `tools/design/wp_specs.py`, `evidence_matrix.py` | 8.4's and 8.5's entries, and 7.3's checks |
| docs/design/README.md | The counts (requirements, packages) and the next unit |
| rounds/MT-03-ORGANIZATION-HOMES.md | A status line: superseded by D170 |
