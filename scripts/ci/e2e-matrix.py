#!/usr/bin/env python3
"""Pick the E2E suites to run and balance them across parallel shards.

Reads .github/e2e-suites.yml (suite keys and optional "# weight=N"), the JSON list of changed suite
names from dorny/paths-filter (CHANGED), and RUN_ALL ("true" runs every suite). Writes two GitHub outputs:
  any     "true" when at least one suite runs
  matrix  {"include":[{"shard":1,"suites":"a b c"}, ...]}  (longest-first greedy balancing)
"""
import json, math, os, re, sys

SHARDS_MAX = int(os.environ.get("E2E_MAX_SHARDS", "4"))
TARGET_SECONDS = 240  # one shard should not take more than about this much test time

suites, weights = [], {}
for line in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"^([a-z0-9][a-z0-9-]*):(.*)$", line)
    if not m or m.group(1) == "shared":
        continue
    name = m.group(1)
    w = re.search(r"weight=(\d+)", m.group(2))
    suites.append(name)
    weights[name] = int(w.group(1)) if w else 50

changed = json.loads(os.environ.get("CHANGED") or "[]")
chosen = suites if os.environ.get("RUN_ALL") == "true" else [s for s in suites if s in changed]

total = sum(weights[s] for s in chosen)
n = min(SHARDS_MAX, len(chosen), max(1, math.ceil(total / TARGET_SECONDS))) if chosen else 0
bins = [{"load": 0, "suites": []} for _ in range(n)]
for s in sorted(chosen, key=lambda x: (-weights[x], x)):
    b = min(bins, key=lambda x: x["load"])
    b["suites"].append(s)
    b["load"] += weights[s]
include = [{"shard": i + 1, "suites": " ".join(b["suites"])} for i, b in enumerate(bins)]
if not include:  # GitHub rejects an empty matrix even when the job is skipped
    include = [{"shard": 0, "suites": ""}]
out = {"any": "true" if chosen else "false", "matrix": json.dumps({"include": include})}
print(out, file=sys.stderr)
with open(os.environ["GITHUB_OUTPUT"], "a") as f:
    for k, v in out.items():
        f.write(f"{k}={v}\n")
