#!/usr/bin/env python3
"""Pick the E2E suites to run and balance them across parallel shards.

Reads .github/e2e-suites.yml (suite keys and optional "# weight=N"), the JSON list of changed suite
names from dorny/paths-filter (CHANGED), RUN_ALL ("true" runs every suite) and SUITES (optional, comma or space separated suite
keys: run only those, whatever else is set; an unknown key is an error). A suite marked "shards=N" becomes N entries "<key>@i/N"
(e2e-run.sh passes --shard=i/N), each its own shard job; one marked "manual" runs only when SUITES names it. Writes two GitHub outputs:
  any     "true" when at least one suite runs
  matrix  {"include":[{"shard":1,"suites":"a b c"}, ...]}  (longest-first greedy balancing)
"""
import json, math, os, re, sys

# Weights are MEASURED seconds (see e2e-suites.yml). A shard also pays about 270 s of fixed cost (runner, npm ci, Supabase start, build,
# upload), so test time of ~930 s per shard plans a shard at about 20 min; the full run (about 7,500 s of tests) needs 8 shards.
# The longest single suite (hunt-edges-probe, ~900 s) cannot be split further by this generator.
SHARDS_MAX = int(os.environ.get("E2E_MAX_SHARDS", "8"))
TARGET_SECONDS = 950  # one shard should not take more than about this much test time

suites, weights, shards, manual = [], {}, {}, set()
for line in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"^([a-z0-9][a-z0-9-]*):(.*)$", line)
    if not m or m.group(1) == "shared":
        continue
    name = m.group(1)
    w = re.search(r"weight=(\d+)", m.group(2))
    k = re.search(r"shards=(\d+)", m.group(2))
    suites.append(name)
    weights[name] = int(w.group(1)) if w else 50
    shards[name] = int(k.group(1)) if k else 1
    if re.search(r"\bmanual\b", m.group(2)):
        manual.add(name)

changed = json.loads(os.environ.get("CHANGED") or "[]")
wanted = [x for x in re.split(r"[,\s]+", os.environ.get("SUITES") or "") if x]
if wanted:
    unknown = [x for x in wanted if x not in suites]
    if unknown:
        sys.exit(f"Unknown suite key(s): {', '.join(unknown)}. Known: {', '.join(suites)}")
    chosen = [s for s in suites if s in wanted]
else:
    chosen = suites if os.environ.get("RUN_ALL") == "true" else [s for s in suites if s in changed]
    chosen = [s for s in chosen if s not in manual]

# a sharded suite becomes one entry per shard, each carrying the per-shard weight
expanded = []
for s in chosen:
    if shards[s] > 1:
        for i in range(1, shards[s] + 1):
            e = f"{s}@{i}/{shards[s]}"
            weights[e] = weights[s]
            expanded.append(e)
    else:
        expanded.append(s)
chosen = expanded

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
