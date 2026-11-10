# Run the test deployment

The project's test deployment is a real `mostra-runtime server` on the public internet, for the external checks a package can't run on one machine: a chat host's connector, a hosted page opened from a phone, the owner's `wait` against a deployed server. WP-30 stood it up (D167 item 20). This playbook refreshes it with a candidate, runs a check on it, and retires it.

## What it is

| | |
|---|---|
| API origin | `https://api.mostradev.com` (the binding, version files, OAuth, `/mcp`) |
| User-content domain | `mostrausercontent.com` and `*.mostrausercontent.com` (the hosted shell and every route's label) |
| Server | the maintainer's machine running Docker, reached as a Docker context; its name and address are in `~/.mostra-deploy/test.json` |
| Front | Caddy with the Cloudflare DNS module (a wildcard certificate by DNS-01), as `docs/reference/self-hosting.md` shows |
| DNS | three address records, DNS only (no proxy), made by `tools/deploy/test/dns.py` and commented "WP-30 test deployment" |
| Sign-in | GitHub, through an OAuth app Mirza owns, callback `https://api.mostradev.com/signin/github/callback` |
| Owner instance | a runtime bundle on Mirza's Mac, on the internal disk, signed in with `mostra login https://api.mostradev.com --default` |

The repository holds the shape (`tools/deploy/test/`): `compose.yaml`, `Caddyfile`, `caddy/Dockerfile`, `server.template.json` and `dns.py`. The secrets and the deployment's own facts stay on Mirza's machine, never in the repository, a log or a commit:

```text
~/.mostra-deploy/cloudflare-token       DNS edit on both zones (it can't make tunnels)
~/.mostra-deploy/github-client-id       the OAuth app's client ID
~/.mostra-deploy/github-client-secret   its secret
~/.mostra-deploy/test.json              { address, zones, dockerContext }
```

All four are mode 0600. On the server, the configuration volume (`mostra-wp30-config`) holds `server.json` (0444) and the GitHub secret (`github`, 0400), owned by UID 10001, the image's user; the Caddy volume (`mostra-wp30-caddy-config`) holds the `Caddyfile` and the Cloudflare token (`cloudflare`, 0400). The compose project is `mostra-wp30`.

## Refresh it with a candidate

Every package that changes the server, the relay, the hosted shell or the MCP surface refreshes the deployment with its candidate before its external checks.

1. Take the candidate's Linux bundle from its pull request's CI run: `gh run download <run> -n bundle-linux-x64 -D /Volumes/Active/<scratch>` (retry on a dropped connection). Its `.json` record pins its size and SHA-256.
2. Build the image on the server, which runs linux/amd64:

   ```sh
   DOCKER_CONTEXT=<context> node packages/bundle/scripts/image.ts --version <version> \
     --bundles <scratch> --platforms linux/amd64 --repository localhost/mostra-server --load
   DOCKER_CONTEXT=<context> docker tag localhost/mostra-server:<version> mostra-server:<package>-<commit>
   ```

3. Start it: `MOSTRA_SERVER_IMAGE=mostra-server:<package>-<commit> docker --context <context> compose -f tools/deploy/test/compose.yaml up -d`. Hosted homes live in the `data` volume and survive the swap.
4. When `server.json` changes, render it from `server.template.json` with the client ID from `~/.mostra-deploy/github-client-id`, copy it into the configuration volume with a throwaway container, and restart the server.
5. Check it from outside, each answer as shown:
   - `curl -s https://api.mostradev.com/health` gives `{"status":"ok",…}`;
   - `/.well-known/oauth-authorization-server` names the issuer and `S256` only;
   - `POST /mcp` without a token gives 401 with `WWW-Authenticate: Bearer resource_metadata="…/mcp"`;
   - a hosted page gives 200 with `origin-agent-cluster: ?1`, the shell's CSP and `x-robots-tag: noindex`;
   - `mostra status` on the owner says `connected`.

## Run an external check

- **claude.ai** (Mirza signs in): Settings, Connectors, **Add custom connector**, URL `https://api.mostradev.com/mcp`, sign in with GitHub, **Continue** on Mostra's consent page. In a new chat, ask the agent to make, publish and share a page, open its link and answer. The owner's `mostra wait <artifact> --until submitted` and `mostra results` show the answer; record the submission ID in the progress report as external evidence.
- **ChatGPT**: write tools on a custom MCP server need a Business or Enterprise workspace (VERIFIED_FACTS, WP-30); Mirza arranges one before the check (M60).
- **Load** (RM-08): `node packages/runtime/scripts/load-anonymous.ts run --link <hosted link> --minutes 30 --out <file>` with the owner stopped, then `verify` once it returns.
- **Backups**: a Litestream 0.5.18 container on the data volume replicates a hosted home's ledger; restore it into a scratch volume and compare its submissions with the live ledger, then remove the container and its volume.

The owner instance runs from a bundle on the internal disk (`~/.mostra-wp30/`): an external disk that drops off ends a daemon mid-run. Start it always-on (`mostra-runtime daemon --always-on`) for checks that wait.

## Retire it

The deployment stays while a package needs a check against a deployed server: WP-17 repeats MC-04 inline through it (D125), and ChatGPT's check waits for a workspace (M60). It is retired when a production deployment takes these names, or when Mirza says so, whichever comes first; the session that does it records it in its progress report.

1. `tools/deploy/test/dns.py --remove` deletes the three records it made; any other record is left alone.
2. `docker --context <context> compose -p mostra-wp30 down -v`, then remove the two configuration volumes and the images tagged `mostra-server:*` and `mostra-wp30-caddy:*`. The data volume holds only test homes.
3. On the owner: `mostra logout https://api.mostradev.com --forget`, stop its daemon, and remove `~/.mostra-wp30/`.
4. Mirza removes the claude.ai connector and changes or deletes the GitHub OAuth app; the four files in `~/.mostra-deploy/` go once nothing uses them.

## Done when

The deployment answers every check in step 5 of the refresh with the candidate's version, the external check's evidence is in the progress report, and nothing secret is in the repository (`git grep` for the token, the client secret and the address finds nothing).
