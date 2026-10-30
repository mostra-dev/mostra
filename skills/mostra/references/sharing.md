# Sharing: links, people and devices

## Contents

- The link
- One person, one link
- The three setups: local, tailnet share, public share
- Behind a public quick tunnel
- Managing links and shares
- Asking people well

## The link

`mostra publish` prints the artifact's **default link**; `mostra open <dir>` prints it again and opens it in a browser when run at a terminal (`--no-browser` only prints it). The link is a capability URL: whoever holds it can view, answer, submit and run the page's actions. The secret is after the `#`, so it never reaches a server log, but treat the whole link like a password.

The default link doesn't expire and stays the same across versions. It opens on this machine only (`http://127.0.0.1:…`).

## One person, one link

A link without a named person acts as one person: everyone who holds the default link shares one draft and one `once` submission. When several people should answer, mint one link per person:

```sh
mostra open ./retro --new --viewer ada@example.com --viewer-name "Ada Lovelace" --no-browser
mostra open ./retro --new --viewer grace@example.com --viewer-name "Grace Hopper" --no-browser
```

`--viewer` is your own stable key for the person (an email, a user ID); the same key always means the same person, and results name them. Use `{ policy: "once", scope: "per-viewer" }` so each of them submits once.

Other options of `mostra open --new`: `--ttl 24h` (the link expires), `--scope view` (look but not answer; also `draft`, `submit`, `review`, `signal`, `action:*`), `--version 3` (only that version).

## The three setups

| Setup | Who can open it | Command |
|---|---|---|
| **Local** | Only this machine's browser | `mostra open <dir>` |
| **Tailnet share** | People and devices in your Tailscale network, such as your phone | `mostra share <dir> --tailnet` |
| **Public share** | Anyone with the link, on any device | `mostra share <dir> --public` |

- **Tailnet share** uses Tailscale Serve. Each person is their tailnet identity, so results name them without `--viewer`. The link doesn't expire unless you give `--ttl`. The output names the two ports the tailnet's access policy must allow, and the viewer's device must run Tailscale.
- **Public share** uses a Cloudflare quick tunnel by default (no account needed), or Tailscale Funnel with `--via funnel` (the URL shows your device's tailnet name). The link lasts 1 hour unless `--ttl` says otherwise, 7 days at most. Each public link is a visitor of its own: their answers never mix with yours or anyone else's, and results show them as "Shared link" unless you pass `--viewer`.
- Both drive tools installed on this machine (`tailscale`, `cloudflared`); when one is missing or signed out, the command says how to install or enable it (`MOSTRA_SHARE_TOOL_MISSING`, `MOSTRA_SHARE_TOOL_NOT_READY`, `MOSTRA_SHARE_NOT_ENABLED`).
- A share keeps Mostra running while it lasts. A quick tunnel can't keep its address across a restart, so a public Cloudflare share ends when Mostra restarts; tailnet and Funnel shares come back.

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

## Asking people well

The link arrives as a message from you, so write it like one:

- Say who is asking and why ("I'm the coding agent working on the checkout redesign; I need your call between two layouts").
- Say what the page asks of them and how long it takes.
- Give a real deadline only if there is one.
- Ask for no passwords, keys or codes on a page; collect secrets through `mostra secret set` instead.
- Post a link somewhere public only if the page is meant for anyone.
