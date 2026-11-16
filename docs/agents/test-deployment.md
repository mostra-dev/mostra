# The test deployment, and checking a candidate against a deployed server

WP-30 stood up a test deployment of `mostra-runtime server` on the public internet (D167 item 20), for the external checks a package can't run on one machine: a chat host's connector, a hosted page opened from a phone, the owner's `wait` against a deployed server. **It was retired on 2026-11-15**, when the hosted service took its names. This playbook says how a package checks its candidate now, and how to stand a test deployment up again should one be needed.

## Check a candidate on the hosted service

The names the test deployment used now serve the hosted service:

| | |
|---|---|
| API origin | `https://api.mostradev.com` (the binding, version files, OAuth, `/mcp`) |
| User-content domain | `mostrausercontent.com` and `*.mostrausercontent.com` |
| Sign-in | GitHub and Google |

1. **A released server** needs nothing: sign in with `mostra login https://api.mostradev.com` and run the check.
2. **A candidate** (a package that changes the server, the relay, the hosted shell or the MCP surface): ask Mirza for a check of the candidate's server image, built from its pull request's CI run (`packages/bundle/scripts/image.ts`). A candidate never runs where people's pages live. Until the hosted service opens to everyone, these names serve only the project's own pages, so Mirza may run the candidate on them and put the release back afterwards; from then on he runs it on a deployment of its own, with names of its own, and gives the package those names. Use the names he gives in the steps below.
3. Check it from outside, each answer as shown (with the names of step 2 where they differ):
   - `curl -s https://api.mostradev.com/health` gives `{"status":"ok",…}`;
   - `/.well-known/oauth-authorization-server` names the issuer and `S256` only;
   - `POST /mcp` without a token gives 401 with `WWW-Authenticate: Bearer resource_metadata="…/mcp"`;
   - a hosted page gives 200 with `origin-agent-cluster: ?1`, the shell's CSP and `x-robots-tag: noindex`;
   - `mostra status` on the owner says `connected`.
4. Run the external check, and record it in the progress report as external evidence:
   - **claude.ai** (Mirza signs in): Settings, Connectors, **Add custom connector**, URL `https://api.mostradev.com/mcp`, sign in, **Continue** on Mostra's consent page. In a new chat, ask the agent to make, publish and share a page, open its link and answer. The owner's `mostra wait <artifact> --until submitted` and `mostra results` show the answer; record the submission ID.
   - **ChatGPT**: write tools on a custom MCP server need a Business or Enterprise workspace (VERIFIED_FACTS, WP-30); Mirza arranges one before the check (M60).

Hosted pages there follow the hosted service's own policies (link lifetimes, quotas). A check that needs a server with none of them uses a test deployment of its own (below).

## Stand a test deployment up again

The shape is still in `tools/deploy/test/`: `compose.yaml`, `Caddyfile`, `caddy/Dockerfile`, `server.template.json` and `dns.py`, as `docs/reference/self-hosting.md` shows. A new one takes names of its own (a user-content domain that serves nothing else, and an API host off it), never the hosted service's, and its own GitHub OAuth app.

1. Its facts and secrets stay on the maintainer's machine, mode 0600, never in the repository, a log or a commit: a DNS token able to edit the zone's records, the OAuth app's client ID and secret, and `{ address, zones, dockerContext }`.
2. Build the candidate's image on the server from its pull request's Linux bundle:

   ```sh
   DOCKER_CONTEXT=<context> node packages/bundle/scripts/image.ts --version <version> \
     --bundles <scratch> --platforms linux/amd64 --repository localhost/mostra-server --load
   ```

3. Render `server.json` from `server.template.json`, copy it and the OAuth secret into the configuration volume (owned by UID 10001), start the compose project, and create its three DNS records with `dns.py`.
4. Run the checks of step 3 above against its names.

## Retire it

1. `tools/deploy/test/dns.py --remove` deletes the records it made; any other record is left alone.
2. `docker --context <context> compose -p <project> down -v`, then remove its configuration volumes and its images.
3. On the owner: `mostra logout <server> --forget`, stop its daemon, and remove its home.
4. Remove the chat hosts' connectors to it and delete its OAuth app.

**The 2026-11-15 retirement** did all four for WP-30's deployment: its three DNS records, its compose project, four volumes and seven images, the owner instance's link and home, the claude.ai connector and its GitHub OAuth app are gone, and each was checked gone. Its test homes held test data only and were not migrated.

## Done when

The check's evidence is in the progress report, and nothing secret is in the repository (`git grep` for the token, the client secret and the address finds nothing).
