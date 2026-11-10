#!/bin/sh
# The container image's smoke test (WP-30, D165 item 11): the image a rehearsal or a release just
# built starts as its non-root user on an empty volume, configured only by environment variables,
# answers its API origin's health and metadata, refuses an unknown Host, and stops on SIGTERM.
#
#   sh packages/bundle/scripts/image-smoke.sh <image>
set -eu
image="$1"
name="mostra-image-smoke-$$"
port=18080

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$name" >/dev/null
docker run -d --name "$name" -v "$name:/data" -p "127.0.0.1:$port:8080" \
  -e MOSTRA_SERVER_API_ORIGIN="http://api.localhost:$port" \
  -e MOSTRA_SERVER_DOMAINS="{\"active\":\"content.localhost:$port\"}" \
  -e MOSTRA_SERVER_SCHEME=http \
  "$image" >/dev/null

ask() {
  curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "http://127.0.0.1:$port$2"
}

i=0
until [ "$(ask "api.localhost:$port" /health)" = 200 ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "image-smoke: the server didn't answer its health within 60 s" >&2
    docker logs "$name" >&2
    exit 1
  fi
  sleep 1
done

uid=$(docker exec "$name" id -u)
[ "$uid" = 10001 ] || { echo "image-smoke: the server runs as uid $uid, not 10001" >&2; exit 1; }
metadata=$(curl -s -H "Host: api.localhost:$port" "http://127.0.0.1:$port/.well-known/oauth-authorization-server")
case "$metadata" in
  *client_id_metadata_document_supported*) ;;
  *) echo "image-smoke: no authorization server metadata: $metadata" >&2; exit 1 ;;
esac
[ "$(ask "unknown.example" /)" = 421 ] || { echo "image-smoke: an unknown Host was served" >&2; exit 1; }
[ "$(ask "api.localhost:$port" /mcp)" = 401 ] || { echo "image-smoke: /mcp answered without a token" >&2; exit 1; }

docker stop -t 20 "$name" >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
[ "$code" = 0 ] || { echo "image-smoke: the server exited $code on SIGTERM" >&2; docker logs "$name" >&2; exit 1; }
echo "image-smoke: $image serves as uid 10001, refuses unknown hosts and stops cleanly"
