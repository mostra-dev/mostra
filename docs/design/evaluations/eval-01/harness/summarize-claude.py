import json, os, sys

rid, t1, t2, L = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]


def usage(path):
    """Token usage from `claude -p --output-format json` (one result object)."""
    if not os.path.exists(path):
        return None
    try:
        d = json.load(open(path))
    except ValueError:
        return {"error": open(path).read()[:300]}
    u = d.get("usage") or {}
    cached = u.get("cache_read_input_tokens", 0)
    total_in = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + cached
    return {"input": total_in, "cached": cached, "output": u.get("output_tokens", 0), "reasoning": 0,
            "models": list((d.get("modelUsage") or {}).keys()), "is_error": d.get("is_error"),
            "turns": d.get("num_turns")}


def verdict(path):
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    i = d.get("interaction") or {}
    return {"pass": d["pass"], "tscErrors": d["typecheck"]["errors"], "build": d["build"]["ok"],
            "dead": i.get("dead"), "idioms": d["idioms"]}


rec = {"id": rid, "secs": [t1, t2],
       "turn1": {"usage": usage(f"{L}/{rid}.turn1.json"), "check": verdict(f"{L}/{rid}.check1.json")},
       "turn2": {"usage": usage(f"{L}/{rid}.turn2.json"), "check": verdict(f"{L}/{rid}.check2.json")}}
with open("results.claude.ndjson", "a") as f:
    f.write(json.dumps(rec) + "\n")
print(json.dumps(rec))
