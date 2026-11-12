# Homes an organization owns: a design for decision (MT-03)

**Status:** Design input, brought to Mirza by MT-03 (D169 item 9). Nothing here is decided or built; the decision is recorded as its own entry, with the package that builds it.

## The problem

A hosted home belongs to one account, and a binding's token names one account, whose home every session acts on (ARCHITECTURE §15.2, §15.3; DATA_MODEL §7.1: `home.owner_account_id` is unique, `instance_link` belongs to the account's home). A team that shares pages as an organization therefore gets one home per member: several sets of links, several senders, and no page that outlives the member who shared it. The ask is one home, one set of links and one sender for the organization, while members keep sharing from their own machines.

What can't change: server code and secrets never leave an owner instance (D117, D165 item 3), so a relayed action of a page runs on the instance that holds its versions; a submission has one delivery owner (D165 item 1b); an operating layer reaches the server only through operator ports (invariant 11), and administering organizations is its concern or `ee/`'s (D165 item 11).

## What has to be decided

**1. What owns the home.**
- (a) **An organization account.** `account.kind` gains `organization`; an organization account owns a home as a person's does, and the home keeps its members with a role (`home_member(home_id, account_id, role)`). The server knows who may act on the home without asking anyone.
- (b) **No membership in the server.** A new port, `accounts.access({ account, home })`, is asked whenever a member's instance links, opens a binding or pushes; the server keeps nothing. Every member action then waits on the operator, and a refusal while it doesn't answer (creating operations fail closed) disconnects members' instances, so deliveries and runs stall with it.
- (c) **An organization instance.** No member links at all: the organization runs an always-on owner instance (`remote/link` with an operator's key, D167 item 21), members hand it each artifact (`mostra export`, then `artifact/import` there), and its server code runs with the organization's own secrets. Real organization ownership, but every share needs that machine and a hand-over.

*Recommendation:* (a). It keeps every check inside the server, as the owner link already is, and costs one table.

**2. How membership reaches the server.**
- (a) **Pushed through the server handle**: `ServerHandle.setMember(home, account, role | null)` and `syncMembers(home, members)` (a full list, to repair drift), durable in the directory. Removing a member closes their bindings to the home within the revocation bound (60 s, as a revoked grant does) and refuses their pushes, shares and links from then on.
- (b) **Pulled through a port** (1 b's `accounts.access`), cached by `cacheForMs`.

*Recommendation:* (a): membership changes rarely, and a member's machine shouldn't lose its link while the operator restarts. A self-hoster without an operator module has no organizations, as now; `ee/` or a module can add them.

**3. Who may do what.** Two roles, as an operating layer's organizations commonly have:
- `member`: shares new artifacts into the organization's home, pushes versions of the artifacts it shared, mints links and pauses or stops its own;
- `owner`: everything a member may, on every artifact of the home, and moves an artifact to another owner instance (item 4).

Role names are strings the handle sets, so finer roles join later without a migration (*recommendation*).

**4. Owner instance and delivery owner.** Each artifact keeps the owner instance that shared it (D165 item 1b): its runs and deliveries go there, and every other member's instance reads and waits on it through the hosted home, as another instance of an account does now. When a member leaves, their artifacts keep serving pages, drafts and submissions, while runs wait or fail by their policy and deliveries wait. So the package also builds **adoption**: an owner moves an artifact to another member's instance once that instance holds its versions (`artifact/import` of its bundle, RM-01), and pending deliveries and waiting runs move to the new owner link in order. D165 item 1b already names moving an artifact as additive.

*Recommendation:* build adoption with organization homes, since without it a departure strands its pages' actions and answers.

**5. Linking an instance to the organization's home.** An instance holds one link per server and home: `mostra login <server> --org <name>` (`remote/login { home }`), each a revocable grant of its own (D165 item 2), and `mostra share --cloud --org <name>` shares into it. The owner's `remote_link` is then keyed by server and home, one binding each.

**6. The sender line** (D161). An organization has no identity provider of its own, so its name is verified by the operator (for example a verified domain), set through the handle with its label. *Recommendation:* "Sent by Acme · verified domain acme.example", with "shared by Ada Lovelace · verified with GitHub" under it, so a respondent sees both the organization and the person; the wording is prose for review (D149).

**7. Remote MCP.** A chat host's token names an account. *Recommendation:* the consent page asks which home the client acts on (the person's or one of their organizations'), and authoring goes to that home's default owner instance among the person's links.

**8. What the operator is told.** Every port call already names the home and the owning account (here the organization, which pays). *Recommendation:* `LimitQuery`, `MeterCounter` and `OperatorEvent` gain `actor` (the member account), additively, so an operator can count seats and attribute use.

## Where it is built

A package of its own, after WP-16 and before the first release: the server's directory and handle, the owner's link and CLI, remote MCP's consent, the sender line, and the operator contract, each additive within `OPERATOR_REVISION` `2026-11-08`. Its number follows D125: **WP-33** (WP-32 was withdrawn), unless Mirza prefers it as a maintenance unit.
