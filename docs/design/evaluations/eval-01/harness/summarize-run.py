import json, os, sys

run_id, t1, t2 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])


def usage(path):
    """Sum token usage reported by codex exec --json (turn.completed events)."""
    tot = {"input": 0, "cached": 0, "output": 0, "reasoning": 0}
    if not os.path.exists(path):
        return None
    for line in open(path):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        u = ev.get("usage") or (ev.get("msg") or {}).get("usage")
        if ev.get("type") == "turn.completed" and u:
            tot["input"] += u.get("input_tokens", 0)
            tot["cached"] += u.get("cached_input_tokens", 0)
            tot["output"] += u.get("output_tokens", 0)
            tot["reasoning"] += u.get("reasoning_output_tokens", 0)
    return tot


def verdict(path):
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    i, r = d.get("interaction") or {}, d.get("render") or {}
    return {"pass": d["pass"], "tsc": d["typecheck"]["ok"], "tscErrors": d["typecheck"]["errors"],
            "build": d["build"]["ok"], "render": r.get("ok"), "dead": i.get("dead"),
            "interactionErrors": len(i.get("errors", [])), "idioms": d["idioms"]}


rec = {"id": run_id, "secs": [t1, t2],
       "turn1": {"usage": usage(f"logs/{run_id}.turn1.jsonl"), "check": verdict(f"logs/{run_id}.check1.json")},
       "turn2": {"usage": usage(f"logs/{run_id}.turn2.jsonl"), "check": verdict(f"logs/{run_id}.check2.json")}}
with open("results.ndjson", "a") as f:
    f.write(json.dumps(rec) + "\n")
print(json.dumps(rec))
