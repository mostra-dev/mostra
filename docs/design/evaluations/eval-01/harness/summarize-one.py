import json, sys
name, path = sys.argv[1], sys.argv[2]
d = json.load(open(path))
i = d.get("interaction") or {}
r = d.get("render") or {}
errs = [e["msg"][:110] for e in (r.get("errors", []) + i.get("errors", []))][:3]
print(f"{name:14} pass={d['pass']!s:5} tsc={d['typecheck']['ok']!s:5}({d['typecheck']['errors']}) build={d['build']['ok']!s:5} "
      f"render={r.get('ok')!s:5} clicked={i.get('clicked')} dead={i.get('dead')} {i.get('deadList')} idioms={d['idioms']} errs={errs}")
