#!/usr/bin/env python3
"""Voice-agent benchmark runner.

Reads models.json + cases.json, drives worker.mjs (Node: real agent loop + GGUF) per
model, grades the traces with grade.py, prints a scoreboard, and (optionally) saves a
score file so the benchmark can be tracked as it grows.

  python3 run.py                       # every model whose GGUF is present
  python3 run.py hammer2.1-1.5b        # one model
  python3 run.py qwen2.5-1.5b qwen2.5-3b --only log-
  python3 run.py --list                # registry + which files exist
  python3 run.py hammer2.1-1.5b --save
  python3 run.py --compare qwen2.5-1.5b hammer2.1-1.5b   # latest saved score of each

Add test cases -> cases.json.  Add / retune models -> models.json.  Adapters -> formats.js.
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent.parent
LOADER = HERE / "_node-loader.mjs"
WORKER = HERE / "worker.mjs"
CASES = HERE / "cases.json"
RESULTS = HERE / "results"
TRACES = RESULTS / "traces"
SCORES = RESULTS / "scores"

sys.path.insert(0, str(HERE))
from grade import score_run  # noqa: E402


def load_models():
    cfg = json.loads((HERE / "models.json").read_text())
    cache = os.path.expanduser(cfg.get("cache_dir", ""))
    out = {}
    for name, m in cfg["models"].items():
        p = m["path"].replace("{cache}", cache)
        p = os.path.expandvars(os.path.expanduser(p))
        out[name] = {**m, "path": p}
    return out


def run_worker(name, m, only):
    TRACES.mkdir(parents=True, exist_ok=True)
    dest = TRACES / f"{name}.json"
    cmd = [
        "node", "--import", str(LOADER), str(WORKER),
        "--model-path", m["path"],
        "--format", m.get("format", "chatml"),
        "--n-ctx", str(m.get("n_ctx", 2048)),
        "--cases", str(CASES),
        "--out", str(dest),
    ]
    if only:
        cmd += ["--only", only]
    print(f"  running {name} ({m.get('format')})  {m['path']}", flush=True)
    r = subprocess.run(cmd, cwd=FRONTEND)
    if r.returncode != 0:
        raise SystemExit(f"worker failed for {name} (exit {r.returncode})")
    return json.loads(dest.read_text())


def scoreboard(name, summary):
    print(f"\n{'=' * 78}\n{name}   {summary['passed']}/{summary['total']}  "
          f"({summary['rate'] * 100:.1f}%)   avg {summary['avg_ms']}ms\n{'-' * 78}")
    for r in summary["cases"]:
        mark = "ok  " if r["passed"] else "FAIL"
        speak = (r["speak"][:52]).replace("\n", " ")
        print(f"{mark} {r['id']:<16} [{','.join(r['tools'])}]".ljust(52) + f'  "{speak}"')
        if not r["passed"]:
            for c in r["checks"]:
                if not c["ok"]:
                    print(f"       - {c['name']}  {c['detail'][:80]}")
    print("=" * 78)


def save_score(name, model, summary):
    SCORES.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    payload = {
        "model": name, "format": model.get("format"), "path": model["path"],
        "ran_at": dt.datetime.now().isoformat(timespec="seconds"),
        "passed": summary["passed"], "total": summary["total"],
        "rate": summary["rate"], "avg_ms": summary["avg_ms"],
        "cases": {r["id"]: r["passed"] for r in summary["cases"]},
    }
    (SCORES / f"{name}-{stamp}.json").write_text(json.dumps(payload, indent=2))
    with (RESULTS / "history.jsonl").open("a") as fh:
        fh.write(json.dumps({k: payload[k] for k in
                 ("model", "ran_at", "passed", "total", "rate", "avg_ms")}) + "\n")
    print(f"saved -> {SCORES / f'{name}-{stamp}.json'}")


def latest_score(name):
    hits = sorted(SCORES.glob(f"{name}-*.json"))
    return json.loads(hits[-1].read_text()) if hits else None


def compare(a, b):
    ra = latest_score(a) or json.loads(Path(a).read_text())
    rb = latest_score(b) or json.loads(Path(b).read_text())
    print(f"{ra['model']:>22}  {ra['passed']}/{ra['total']} ({ra['rate']*100:.1f}%)   "
          f"vs  {rb['model']}  {rb['passed']}/{rb['total']} ({rb['rate']*100:.1f}%)\n")
    ids = sorted(set(ra["cases"]) | set(rb["cases"]))
    for cid in ids:
        pa, pb = ra["cases"].get(cid), rb["cases"].get(cid)
        if pa != pb:
            print(f"  {cid:<18} {('ok' if pa else 'FAIL'):>5}  ->  {'ok' if pb else 'FAIL'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("models", nargs="*", help="model names from models.json (default: all present)")
    ap.add_argument("--only", help="run just cases whose id contains this substring")
    ap.add_argument("--save", action="store_true", help="write a score file + history line")
    ap.add_argument("--list", action="store_true", help="show the model registry and exit")
    ap.add_argument("--compare", nargs=2, metavar=("A", "B"), help="diff two models' latest saved scores")
    args = ap.parse_args()

    registry = load_models()

    if args.list:
        for name, m in registry.items():
            print(f"  {'ok ' if os.path.exists(m['path']) else 'MISS'} {name:<18} {m.get('format'):<10} {m['path']}")
        return
    if args.compare:
        compare(*args.compare)
        return

    cases = json.loads(CASES.read_text())["cases"]
    names = args.models or [n for n, m in registry.items() if os.path.exists(m["path"])]
    if not names:
        raise SystemExit("no models to run (none of the GGUFs in models.json exist; see --list)")

    results = {}
    for name in names:
        if name not in registry:
            raise SystemExit(f"unknown model '{name}' (see --list)")
        m = registry[name]
        if not os.path.exists(m["path"]):
            raise SystemExit(f"{name}: GGUF not found at {m['path']}\n  download: {m.get('download', '(see models.json)')}")
        traces = run_worker(name, m, args.only)
        summary = score_run(cases, traces["cases"])
        scoreboard(name, summary)
        results[name] = summary
        if args.save:
            save_score(name, m, summary)

    if len(results) > 1:
        print("\nsummary")
        for name, s in results.items():
            print(f"  {name:<20} {s['passed']}/{s['total']}  ({s['rate']*100:.1f}%)  avg {s['avg_ms']}ms")


if __name__ == "__main__":
    main()
