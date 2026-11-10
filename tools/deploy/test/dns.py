#!/usr/bin/env python3
"""The test deployment's DNS records (docs/agents/test-deployment.md): address records, DNS only
(no proxy), so the self-hosting docs' own shape is what runs: Caddy with a wildcard certificate in
front of the server's container. Idempotent; prints no secret. `--remove` takes them down.

The token and the deployment's facts (its address, the zones' IDs) live on the maintainer's machine
in `~/.mostra-deploy/`, never in the repository.
"""
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = open(os.path.expanduser("~/.mostra-deploy/cloudflare-token")).read().strip()
FACTS = json.load(open(os.path.expanduser("~/.mostra-deploy/test.json")))
ZONES = FACTS["zones"]
ADDRESS = FACTS["address"]
HOSTS = [
    ("api.mostradev.com", "mostradev.com"),
    ("mostrausercontent.com", "mostrausercontent.com"),
    ("*.mostrausercontent.com", "mostrausercontent.com"),
]


def call(method, path, body=None):
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            answer = json.load(response)
    except urllib.error.HTTPError as error:
        answer = json.load(error)
    if not answer.get("success"):
        raise SystemExit(f"{method} {path}: {answer.get('errors')}")
    return answer["result"]


remove = len(sys.argv) > 1 and sys.argv[1] == "--remove"
for host, zone in HOSTS:
    zone_id = ZONES[zone]
    # Only address records: the apex's mail records (MX, TXT) are left as they are.
    found = [
        r
        for r in call("GET", f"/zones/{zone_id}/dns_records?name={host}")
        if r["type"] in ("A", "AAAA", "CNAME")
    ]
    mine = [r for r in found if (r.get("comment") or "").startswith("WP-30 test deployment")]
    others = [r for r in found if r not in mine]
    if others:
        raise SystemExit(f"{host} has records this script didn't make; not touched")
    if remove:
        for record in mine:
            call("DELETE", f"/zones/{zone_id}/dns_records/{record['id']}")
            print("dns removed:", host)
        continue
    record = {
        "type": "A",
        "name": host,
        "content": ADDRESS,
        "proxied": False,
        "ttl": 300,
        "comment": "WP-30 test deployment (Caddy on the test server)",
    }
    if mine:
        call("PUT", f"/zones/{zone_id}/dns_records/{mine[0]['id']}", record)
        print("dns updated:", host)
    else:
        call("POST", f"/zones/{zone_id}/dns_records", record)
        print("dns created:", host)
