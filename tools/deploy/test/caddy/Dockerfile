# The test deployment's TLS front: Caddy with the Cloudflare DNS module, for a wildcard
# certificate on the user-content domain (DNS-01). Pinned; built on the test server.
FROM caddy:2.11.8-builder AS build
RUN xcaddy build v2.11.8 --with github.com/caddy-dns/cloudflare@v0.2.4
FROM caddy:2.11.8
COPY --from=build /usr/bin/caddy /usr/bin/caddy
