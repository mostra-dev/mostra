# Self-hosting the remote server

The remote server hosts shared pages so their links keep working while the machine that shared them sleeps. It also hosts the remote MCP endpoint for chat apps. You run it as one container behind a TLS front. This page shows the shape with Caddy. Any TLS terminator that keeps the request's `Host` and adds `X-Forwarded-For` works the same way.

## What you need

- **A host name for the API origin**, such as `api.example.com`. Owners sign in and connect there, chat apps reach `/mcp` there, and version files upload there.
- **A user-content domain of its own**, such as `example-usercontent.com`. Its apex serves the hosted shell, and each shared page gets a random label under it (`<label>.example-usercontent.com`). Use a registrable domain that serves nothing else, and keep the API origin off it. A page on it can set cookies for the whole domain, so nothing else should live there.
- **DNS** for the API host, the user-content apex and the wildcard `*.example-usercontent.com`, all pointing at your front. Labels are one level deep, so one wildcard certificate covers every page.
- **One machine** with Docker and a local disk. The data directory can't be on a network filesystem: the server refuses NFS, SMB and network FUSE mounts at start.

## Configuration

The server reads a JSON file (`--config`) and `MOSTRA_SERVER_<KEY>` variables. A variable overrides the file's key. It holds JSON, or a plain string for `apiOrigin`, `operator` and `scheme`. If the server can't use a key, it stops before serving anything and names the key (`MOSTRA_REMOTE_CONFIG_INVALID`).

```json
{
  "apiOrigin": "https://api.example.com",
  "domains": { "active": "example-usercontent.com" },
  "trustedProxies": ["172.31.230.0/24"],
  "identityProviders": [
    {
      "id": "github",
      "kind": "github",
      "label": "GitHub",
      "clientId": "<the OAuth app's client ID>",
      "clientSecretFile": "/run/secrets/github"
    }
  ],
  "rateLimits": {
    "perIp": { "submissions": { "count": 120, "per": "1m" } },
    "perLink": { "submissions": { "count": 600, "per": "1m" } }
  }
}
```

| Key | What it does |
|---|---|
| `apiOrigin` | The API origin, `https:` |
| `domains.active`, `domains.spares` | The user-content domain new links use, and older ones that issued links keep working on. To move off a domain, make a spare active and restart the server |
| `trustedProxies` | Addresses or CIDR ranges whose `X-Forwarded-For` the server believes. It reads the header from the right and takes the first address that isn't a trusted proxy. Rate limits count IPv6 clients per /64 (`rateLimits.ipv6Prefix`) |
| `identityProviders` | How people sign in: `github` (an OAuth app), `oidc` (any OpenID Connect provider: `issuer`, `clientId`, `clientSecretFile`) or `development` (trusts any typed name; for tests only, never on a public server). An `oidc` entry's `claims` names up to 8 of its ID token's claims (such as `hd`, a Google Workspace account's domain) that an operator module then reads in the sign-in's `facts`. A page's sender line says the name was verified with the provider's `label`, as recorded when the person signed in, so renaming or removing a provider later leaves names already verified as they were |
| `rateLimits` | Rates as `{ "count", "per" }`: `perIp.submissions` and `perLink.submissions` for answers, `perLink.relayedRuns` for actions, and `perIp.requests` for every request an address sends (a health check aside). Past a rate the answer is 429 with `Retry-After`; a page says to try again shortly and keeps the draft. A key left out is no limit |
| `relay`, `homes`, `ledger` | The relay's waiting-run cap and drain rate, how long an idle hosted home stays open, and the ledger's WAL checkpoint (`0` for a backup replicator) |
| `operator` | The path of an operator module, which adds limits, metering, accounts and abuse handling through the operator ports (`@mostra/protocol/operator`). Without one, every port keeps its no-op default |
| `appearance` | How the server's own pages (sign-in, linking a machine, a chat app's consent, and the page someone meets at a link that doesn't work) look and name themselves. `name` is what they call the server (`Mostra` unless you set another name, or `null` for none); `logo` is an image of yours the server serves (`{ "file", "alt", "width", "height" }`, an `.svg`, `.png` or `.webp` of at most 256 KiB); `default` is `system`, `light` or `dark`, before a person picks with the page's own button; `footer` adds up to six links (your terms, privacy, help). Every page says "Runs on Mostra" in its footer, and every hosted page carries the small Mostra mark with "Make pages like this" unless an operator module's `policy.link` turns it off for the pages it serves unbranded |

For GitHub sign-in, create an OAuth app with the callback `https://api.example.com/signin/github/callback`. For OpenID Connect, register the redirect URI `https://api.example.com/signin/<id>/callback`. Keep each client secret in a file that only the container's user (UID 10001) can read.

## Running it with Caddy

The image is `ghcr.io/mostra-dev/mostra-server`, tagged with each release's version, for `linux/amd64` and `linux/arm64`. It runs `mostra-runtime server` as a non-root user. It listens on port 8080 and keeps everything in `/data`: hosted homes, version files and the server's keys. Append `--config <file>` to its command, or set the `MOSTRA_SERVER_*` variables.

`compose.yaml`:

```yaml
networks:
  front:
    ipam:
      config:
        - subnet: 172.31.230.0/24
volumes:
  data: {}
  caddy-data: {}
services:
  mostra-server:
    image: ghcr.io/mostra-dev/mostra-server:<version>
    command: ["--config", "/config/server.json"]
    restart: unless-stopped
    networks: [front]
    read_only: true
    tmpfs: [/tmp]
    volumes:
      - data:/data
      - ./server.json:/config/server.json:ro
      - ./github-secret:/run/secrets/github:ro
  caddy:
    image: <caddy built with the caddy-dns module for your DNS provider>
    restart: unless-stopped
    networks: [front]
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./dns-token:/run/secrets/dns-token:ro
      - caddy-data:/data
```

`Caddyfile`:

```caddyfile
{
	servers {
		# A sibling page can fill the domain's cookie jar: pass up to 1 MiB of headers.
		max_header_size 1MiB
	}
}

api.example.com {
	reverse_proxy mostra-server:8080
}

example-usercontent.com, *.example-usercontent.com {
	tls {
		dns cloudflare {file./run/secrets/dns-token}
	}
	reverse_proxy mostra-server:8080
}
```

The wildcard certificate needs the DNS-01 challenge, so Caddy needs a build with your DNS provider's module (`xcaddy build --with github.com/caddy-dns/<provider>`) and a token that may edit the zone's records, kept in the file `dns-token` beside the `Caddyfile` (readable by the user Caddy runs as, and by nobody else) and read by `{file.…}`, so it is in no environment a process listing or a log can show. Caddy keeps the request's `Host` and adds `X-Forwarded-For`, and the server believes that header only from the network `trustedProxies` names.

Check the server once it runs:

```sh
curl https://api.example.com/health                                     # {"status":"ok",…}
curl https://api.example.com/.well-known/oauth-authorization-server     # the sign-in metadata
```

An owner then links a machine with `mostra login https://api.example.com` and shares a page with `mostra share <dir> --cloud`. A chat app connects to `https://api.example.com/mcp`.

## Fronts and request headers

Hosted pages use no cookies, and the server drops every `Cookie` header unread. A tenant's page can still fill the user-content domain's cookie jar, and browsers then send up to about 720 KiB of cookies with each request. The server accepts headers up to 1 MiB, so such a jar never costs another page its session. Your front has to pass them too. Caddy's default is 16 KiB, so the Caddyfile above raises it with `max_header_size 1MiB`. A CDN or proxy whose limit is smaller fails every page on the domain for a browser whose jar a sibling page filled.

## Backups and restores

Each hosted home's ledger is SQLite in WAL mode with normal locking, so a WAL replicator such as Litestream can read it live from its own process. Back up the whole data directory. After restoring a home, or the whole directory, by hand, start the server with `--restored <homeId>` or `--restored all`. The restored homes then rotate their incarnations before they serve anything, so owners never mistake reused cursors for ones they already copied. Each owner's machine also notices a home that holds less than it copied, and records the gap as `remote.regressed`.

## What the open server doesn't do

It imposes no quota, link expiry or automatic pause, deletes nothing on its own, and sends no email or webhook. Plans, quotas, billing, abuse scoring, placing homes across machines, backup automation and outside domains come from an operator module through the operator ports. An operator pauses, quarantines, suspends and removes through the server handle the module receives.
