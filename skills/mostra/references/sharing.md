# Sharing: links, people and devices

## Contents

- The link
- One person, one link
- The four setups: local, tailnet share, public share, hosted
- Hosted on a server
- Behind a public quick tunnel
- Managing links and shares
- Moving a version to another machine
- Asking people well

## The link

`mostra publish` prints the artifact's **default link**; `mostra open <dir>` prints it again; `--browser` also opens it in this machine's browser (without it, only a terminal opens one), and stderr says when no browser opened. The link is a capability URL: whoever holds it can view, answer, submit and run the page's actions. The secret is after the `#`, so it never reaches a server log, but treat the whole link like a password.

The default link doesn't expire and stays the same across versions. It opens on this machine only (`http://127.0.0.1:…`).

## One person, one link

A link without a named person acts as one person: everyone who holds the default link shares one draft and one `once` submission. When several people should answer, mint one link per person:

```sh
mostra open ./retro --new --viewer ada@example.com --viewer-name "Ada Lovelace" --no-browser
mostra open ./retro --new --viewer grace@example.com --viewer-name "Grace Hopper" --no-browser
```

`--viewer` is your own stable key for the person (an email, a user ID); the same key always means the same person, and results name them. Use `{ policy: "once", scope: "per-viewer" }` so each of them submits once.

Other options of `mostra open <dir> --new`: `--ttl 24h` (the link expires), `--scope view` (look but not answer; also `draft`, `submit`, `review`, `signal`, `action:*`), `--version 3` (only that version).

## The four setups

| Setup | Who can open it | Command |
|---|---|---|
| **Local** | Only this machine's browser | `mostra open <dir> --browser` |
| **Tailnet share** | People and devices in your Tailscale network, such as your phone | `mostra share <dir> --tailnet` |
| **Public share** | Anyone with the link, on any device | `mostra share <dir> --public` |
| **Hosted** | Anyone with the link, even while this machine sleeps | `mostra share <dir> --cloud` |

- **Tailnet share** uses Tailscale Serve. Each person is their tailnet identity, so results name them without `--viewer`. The link doesn't expire unless you give `--ttl`. The output names the two ports the tailnet's access policy must allow, and the viewer's device must run Tailscale.
- **Public share** uses a Cloudflare quick tunnel by default (no account needed), or Tailscale Funnel with `--via funnel` (the URL shows your device's tailnet name). The link lasts 1 hour unless `--ttl` says otherwise, 7 days at most. Each public link is a visitor of its own: their answers never mix with yours or anyone else's, and results show them as "Shared link" unless you pass `--viewer`.
- Both drive tools installed on this machine (`tailscale`, `cloudflared`); when one is missing or signed out, the command says how to install or enable it (`MOSTRA_SHARE_TOOL_MISSING`, `MOSTRA_SHARE_TOOL_NOT_READY`, `MOSTRA_SHARE_NOT_ENABLED`).
- A share keeps Mostra running while it lasts. A quick tunnel can't keep its address across a restart, so a public Cloudflare share ends when Mostra restarts; tailnet and Funnel shares come back.

## Hosted on a server

`mostra share <dir> --cloud` puts the latest version on a remote server this machine signed in to, and prints a link there. The page keeps taking answers while this machine is off: they wait on the server and reach `mostra wait` and `mostra results` here when Mostra runs again, the same as local answers. Every later `mostra publish` of the artifact goes to the server too.

```sh
mostra login https://api.example.com      # once per machine: open the address it prints and approve the code
mostra share ./x --cloud                  # host it there; prints the hosted link
mostra status                             # the servers this machine is linked to, and whether they're connected
mostra logout                             # sign out; hosted pages keep working, answers wait for the next login
```

- The person answering sees "Your answer was sent." once the server has it, and nothing about this machine. You see the delivery states.
- Only the source, its versions and its secrets stay on this machine; the server holds the built page and what people enter.
- Several machines can sign in to one account. The one that shared a page receives its answers. `mostra login <server> --default` makes this machine the one pages created from a chat app go to.
- `mostra share stop` and `mostra share list` include hosted shares.
- `mostra pause ./x --reason "Closed until Monday"` stops a page taking answers and running actions, here and on every server it's hosted on; it stays viewable, its links keep working, and the draft people typed is kept. `mostra resume ./x` opens it again. A pause the server's operator made can only be lifted by the operator.

### Actions on a hosted page

A hosted page's actions run on this machine, with its secrets, while it is connected. The manifest's `hosted` key says how they behave on the server:

```tsx
export const artifact = defineArtifact({
  title: "Proposal",
  hosted: {
    actions: "link",                                 // who may press them: "signed-in" (default) or anyone with the link
    offline: { actions: "queue", limit: "24h" },     // while this machine is off: wait ("queue", default) or fail at once ("fail")
  },
});
```

- By default only people the link names (`--viewer`) or who signed in may run actions; `actions: "link"` lets anyone with the link run them.
- While this machine is off, a pressed action waits: `useAction`'s `status` is `"waiting"`, and it runs once, in order, when Mostra runs here again. Past `limit` (at most `7d`) a run that never started fails. Under `"fail"` it fails at once.
- If the connection drops while an action runs and this machine never reports how it ended within the limit, its `status` becomes `"unknown"`: it may have happened, so show that rather than "failed". `run()` rejects with `MOSTRA_REMOTE_OWNER_OFFLINE`; the real end replaces `unknown` if it arrives later.
- A plain server function (called directly, not through `useAction`) answers `MOSTRA_REMOTE_OWNER_OFFLINE` while this machine is off.
- Live values show the last value, with `ownerOffline` set, while this machine is off.

## Behind a public quick tunnel

Over a Cloudflare quick tunnel the page runs in a slightly different mode, and nothing in your code needs to change for it:

- updates arrive by polling rather than streaming, so other people's edits and live values show up a second or two later;
- a streamed result (an async iterable) arrives in one piece at the end;
- the page can't register a service worker of its own (`MOSTRA_HYGIENE_FRAME_SESSION`).

## Managing links and shares

```sh
mostra share list               # active shares, with their links
mostra share list --all         # ended ones too, and why
mostra share stop <shareId>     # or the artifact, for all of its shares; the link stops working
mostra open ./x --rotate <tokenId>   # replace a link that leaked; the old one stops working
mostra open ./x --revoke <tokenId>   # stop a link
```

`--json` output carries each link's `tokenId`.

## Sending the page as files

An export writes the page's front end out of Mostra, for someone without a link, an archive or a static host:

```sh
mostra export ./x --as static --out ./x-page          # a folder: open index.html, or host it anywhere
mostra export ./x --as static --base /repo/ --out ./x-page   # hosted at a subpath (GitHub Pages)
mostra export ./x --as html --out ./x.html            # one file with everything inside
mostra export ./x --as snapshot --out ./x-snapshot    # the page as it stands, answers and state frozen
```

- An export is the front end only: fields keep answers in the browser that opens it, and the page says what doesn't work there (Submit, actions, live data). Its server code, secrets and environment never go into it.
- The result names each thing the export loses, and each address it needs a network for (`warnings`, and `report` with `--json`); `--strict` makes them an error and writes nothing. Export a snapshot to keep answers and state, or a bundle (below) to keep actions running.
- A snapshot holds your own answers now, or a submission's with `--submission <id>`, and the shared state, which may hold other people's answers: the result says how many people it covers, and `--no-shared-state` leaves it out. Sensitive fields are left out.
- Demos ([demos.md](demos.md)) go into every export. A folder opens them from disk, and works fully served at a host's root (`npx serve <folder>`) or at the subpath `--base` names; one HTML file holds the demos built as ES modules (Vite's are) and says in place of any other that it needs the folder version. A demo routed by browser history opens on its first page from disk, and moving between its pages there needs a web server, as the folder's README.txt says.

*Done when* the result's warnings name only what you meant the export to lose.

## Moving a version to another machine

A published version can move whole to another Mostra home, where it is the same version with the same IDs, and its actions run there:

```sh
mostra export ./x --out ./x.tar.zst       # the latest version; --version 2 for another
mostra run ./x.tar.zst                    # on the other machine: imports it and prints its link
```

The bundle holds the version's builds, manifest, lockfile and source, never secrets: set the secrets its actions read on the other machine with `mostra secret set`. Answers stay in the home where people gave them.

## Asking people well

The link arrives as a message from you, so write it like one:

- Say who is asking and why ("I'm the coding agent working on the checkout redesign; I need your call between two layouts").
- Say what the page asks of them and how long it takes.
- Give a real deadline only if there is one.
- Ask for no passwords, keys or codes on a page; collect secrets through `mostra secret set` instead.
- Post a link somewhere public only if the page is meant for anyone.
