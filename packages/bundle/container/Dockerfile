# syntax=docker/dockerfile:1.10
# The remote server's container image (ARCHITECTURE §15.11, D165 item 11, WP-30): the release's own
# Linux runtime bundle (D142: attested, hash-pinned, with its private Node.js), run as a non-root
# user with one data volume. The build context's `bundles/` holds the release's Linux bundles and
# their records (`mostra-<version>-linux-x64.tar.gz` and `.json`, the same for `linux-arm64`), which
# `scripts/image.ts` checks against their records before anything is built; each architecture's
# layer unpacks its own.
#
#   docker run -v mostra-data:/data -p 8080:8080 \
#     -e MOSTRA_SERVER_API_ORIGIN=https://api.example \
#     -e MOSTRA_SERVER_DOMAINS='{"active":"usercontent.example"}' ghcr.io/mostra-dev/mostra-server
#
# Every configuration key comes from `MOSTRA_SERVER_<KEY>`, or from a file passed as
# `--config /etc/mostra/server.json` after the image name (INTERFACES §18.1). TLS belongs to a
# terminator in front (docs/reference/self-hosting.md shows Caddy).
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

ARG VERSION
ARG TARGETARCH

# CA certificates, for the server's own requests (identity providers, Client ID Metadata
# Documents); tini as PID 1, so the server receives SIGTERM and stops cleanly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

RUN --mount=type=bind,source=bundles,target=/bundles \
  set -eu; \
  case "$TARGETARCH" in \
    amd64) platform=x64 ;; \
    arm64) platform=arm64 ;; \
    *) echo "unsupported architecture $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  mkdir -p /opt/mostra; \
  tar -xzf "/bundles/mostra-$VERSION-linux-$platform.tar.gz" -C /opt/mostra --strip-components=1; \
  test -x /opt/mostra/bin/mostra-runtime

RUN groupadd --system --gid 10001 mostra \
  && useradd --system --uid 10001 --gid mostra --home-dir /data --shell /usr/sbin/nologin mostra \
  && mkdir -p /data /etc/mostra \
  && chown mostra:mostra /data \
  && chmod 0700 /data

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
STOPSIGNAL SIGTERM
LABEL org.opencontainers.image.title="Mostra remote server" \
  org.opencontainers.image.description="Hosts Mostra artifacts for many homes behind one gateway, with remote MCP" \
  org.opencontainers.image.source="https://github.com/mostra-dev/mostra" \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.version="$VERSION"
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mostra/bin/mostra-runtime", "server", "--data", "/data", "--listen", "0.0.0.0:8080"]
