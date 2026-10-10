#!/usr/bin/env python3
"""Re-score every evaluation run with the final checker. No model calls.
Turn-1 code comes from snapshots/<id>/src.turn1 when present; for runs without a repair turn the
final code is the turn-1 code. Runs repaired before snapshots existed have no turn-1 code; their
turn-1 verdict is taken from the original check1 log and marked as such."""
import json, os, shutil, subprocess, sys, pathlib

root = pathlib.Path(__file__).resolve().parent
src_file = sys.argv[1] if len(sys.argv) > 1 else "results.ndjson"
out_file = sys.argv[2] if len(sys.argv) > 2 else "rescore.ndjson"
runs = [json.loads(l) for l in open(root / src_file)]
out = open(root / out_file, "w")
port = 5900
for r in runs:
    rid = r["id"]
    base = rid.split("-")[0]
    repaired = r["turn2"]["usage"] is not None
    rec = {"id": rid, "base": base, "prompt": int(rid.split("-p")[1][:2]), "repaired": repaired,
           "tokens": sum(x["usage"]["input"] + x["usage"]["output"] for x in (r["turn1"], r["turn2"]) if x["usage"])}
    def check(src_dir, label):
        global port
        port += 1
        work = root / "rescore-work" / f"{rid}-{label}"
        if work.exists():
            shutil.rmtree(work)
        shutil.copytree(root / f"tpl-{base}", work, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
        os.symlink(root / f"tpl-{base}" / "node_modules", work / "node_modules")
        shutil.rmtree(work / "src")
        shutil.copytree(src_dir, work / "src")
        p = subprocess.run(["node", str(root / "check.mjs"), str(work), str(port)], capture_output=True, text=True, timeout=600)
        try:
            return json.loads(p.stdout.strip().splitlines()[-1])
        except Exception:
            return {"pass": False, "error": p.stderr[-500:]}
    snap = root / "snapshots" / rid / "src.turn1"
    if snap.exists():
        rec["turn1"] = check(snap, "t1"); rec["turn1_source"] = "snapshot"
    elif not repaired:
        rec["turn1"] = check(root / "runs" / rid / "src", "t1"); rec["turn1_source"] = "final (no repair turn)"
    else:
        rec["turn1"] = json.load(open(root / "logs" / f"{rid}.check1.json")); rec["turn1_source"] = "original check1 log (pre-fix checker)"
    rec["final"] = check(root / "runs" / rid / "src", "final") if repaired else rec["turn1"]
    out.write(json.dumps(rec) + "\n"); out.flush()
    t1, fi = rec["turn1"], rec["final"]
    print(rid, "turn1", t1.get("pass"), "final", fi.get("pass"), (t1.get("interaction") or {}).get("deadList"), file=sys.stderr)
