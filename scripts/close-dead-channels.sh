#!/bin/bash
#
# Close the least-active Lightning channels that have recoverable local balance.
#
# Usage:
#   ./close-dead-channels.sh                # dry-run (default)
#   ./close-dead-channels.sh --execute      # actually close channels
#
# Options (set via env vars):
#   FUNDS_DIR     - path to balance snapshots (default: ~/coinos-server/data/funds)
#   COUNT         - number of channels to close (default: 10)
#   MIN_LOCAL_PCT - minimum local balance % to consider (default: 20)
#   MONTHS        - how many months of history to analyze (default: 3)
#   CLOSE_TIMEOUT - seconds to wait for cooperative close (default: 1)
#   EXCLUDE       - comma-separated SCIDs or alias substrings to skip

set -euo pipefail

FUNDS_DIR="${FUNDS_DIR:-$HOME/coinos-server/data/funds}"
COUNT="${COUNT:-10}"
MIN_LOCAL_PCT="${MIN_LOCAL_PCT:-20}"
MONTHS="${MONTHS:-3}"
CLOSE_TIMEOUT="${CLOSE_TIMEOUT:-1}"
EXCLUDE="${EXCLUDE:-}"
EXECUTE=false

if [[ "${1:-}" == "--execute" ]]; then
  EXECUTE=true
fi

python3 - "$FUNDS_DIR" "$COUNT" "$MIN_LOCAL_PCT" "$MONTHS" "$EXCLUDE" << 'PYEOF'
import json, subprocess, os, re, sys
from datetime import datetime, timedelta
from collections import defaultdict

FUNDS_DIR = sys.argv[1]
COUNT = int(sys.argv[2])
MIN_LOCAL_PCT = float(sys.argv[3])
MONTHS = int(sys.argv[4])
EXCLUDE = [x.strip().lower() for x in sys.argv[5].split(",") if x.strip()]

def parse_date(fn):
    fn = fn.replace('balances_', '')
    m = re.match(r'(\d{2})-(\d{2})-(\d{2})-(\d{2}):(\d{2}):(\d{2})\.json', fn)
    if not m:
        return None
    month, day, year, hour, minute, sec = [int(x) for x in m.groups()]
    try:
        return datetime(year + 2000, month, day, hour, minute, sec)
    except:
        return None

def fmt(s):
    if abs(s) >= 1_000_000:
        return f"{s/1_000_000:.2f}M"
    elif abs(s) >= 1_000:
        return f"{s/1_000:.1f}k"
    return str(s)

# Sample balance files every ~4 hours over the lookback period
files = sorted(os.listdir(FUNDS_DIR))
cutoff = datetime.now() - timedelta(days=MONTHS * 30)
recent = [(d, f) for f in files if (d := parse_date(f)) and d >= cutoff]
recent.sort()

sampled = []
last = None
for d, f in recent:
    if last is None or (d - last).total_seconds() >= 4 * 3600:
        sampled.append((d, f))
        last = d

print(f"Analyzed {len(sampled)} snapshots over {MONTHS} months\n")

# Build movement history per channel
channel_history = defaultdict(list)
for d, f in sampled:
    try:
        with open(os.path.join(FUNDS_DIR, f)) as fh:
            data = json.load(fh)
    except:
        continue
    for ch in data.get("channels", []):
        scid = ch.get("short_channel_id", "")
        if scid:
            channel_history[scid].append(
                (d, ch["our_amount_msat"], ch["amount_msat"], ch.get("state", ""))
            )

# Get currently open channels
result = subprocess.run(
    ["docker", "exec", "cl", "lightning-cli", "listpeerchannels"],
    capture_output=True, text=True, timeout=15,
)
peerchans = json.loads(result.stdout)

# Resolve aliases
aliases = {}
def get_alias(peer_id):
    if peer_id in aliases:
        return aliases[peer_id]
    try:
        r = subprocess.run(
            ["docker", "exec", "cl", "lightning-cli", "listnodes", peer_id],
            capture_output=True, text=True, timeout=10,
        )
        nd = json.loads(r.stdout)
        a = nd["nodes"][0].get("alias", peer_id[:20] + "...") if nd.get("nodes") else peer_id[:20] + "..."
    except:
        a = peer_id[:20] + "..."
    aliases[peer_id] = a
    return a

# Score each open channel
candidates = []
for ch in peerchans.get("channels", []):
    scid = ch.get("short_channel_id", "")
    state = ch.get("state", "")
    if not scid or state != "CHANNELD_NORMAL":
        continue

    capacity = ch.get("total_msat", 0) // 1000
    local = ch.get("to_us_msat", 0) // 1000
    if capacity == 0:
        continue
    local_pct = 100 * local / capacity
    if local_pct < MIN_LOCAL_PCT:
        continue

    history = channel_history.get(scid, [])
    normal = [(d, o, t) for d, o, t, s in history if s == "CHANNELD_NORMAL"]
    movement = 0
    if len(normal) >= 2:
        for i in range(1, len(normal)):
            movement += abs(normal[i][1] - normal[i - 1][1])

    candidates.append({
        "scid": scid,
        "peer_id": ch.get("peer_id", ""),
        "capacity": capacity,
        "local": local,
        "remote": capacity - local,
        "local_pct": local_pct,
        "movement": movement // 1000,
    })

candidates.sort(key=lambda x: x["movement"])

# Apply exclusions and take bottom N
selected = []
for c in candidates:
    if len(selected) >= COUNT:
        break
    alias = get_alias(c["peer_id"])
    skip = False
    for exc in EXCLUDE:
        if exc in c["scid"].lower() or exc in alias.lower():
            skip = True
            break
    if skip:
        print(f"  SKIP (excluded): {c['scid']}  {alias}")
        continue
    c["alias"] = alias
    selected.append(c)

# Print results
print(f"{'SCID':<18} {'Peer':<30} {'Capacity':>10} {'Local':>10} {'Remote':>10} {'Local%':>7} {'3mo Vol':>10}")
print("-" * 105)
for c in selected:
    print(
        f"{c['scid']:<18} {c['alias']:<30} {fmt(c['capacity']):>10} "
        f"{fmt(c['local']):>10} {fmt(c['remote']):>10} {c['local_pct']:>6.1f}% "
        f"{fmt(c['movement']):>10}"
    )

total_local = sum(c["local"] for c in selected)
total_cap = sum(c["capacity"] for c in selected)
print(f"\nRecoverable local: {fmt(total_local)} sats | Capacity freed: {fmt(total_cap)} sats")

# Output SCIDs for the shell to close
scid_list = " ".join(c["scid"] for c in selected)
print(f"\nSCIDS={scid_list}")
PYEOF

# Parse SCIDs from python output
SCIDS=$(python3 - "$FUNDS_DIR" "$COUNT" "$MIN_LOCAL_PCT" "$MONTHS" "$EXCLUDE" << 'PYEOF' 2>/dev/null | tail -1
import json, subprocess, os, re, sys
from datetime import datetime, timedelta
from collections import defaultdict

FUNDS_DIR = sys.argv[1]
COUNT = int(sys.argv[2])
MIN_LOCAL_PCT = float(sys.argv[3])
MONTHS = int(sys.argv[4])
EXCLUDE = [x.strip().lower() for x in sys.argv[5].split(",") if x.strip()]

def parse_date(fn):
    fn = fn.replace('balances_', '')
    m = re.match(r'(\d{2})-(\d{2})-(\d{2})-(\d{2}):(\d{2}):(\d{2})\.json', fn)
    if not m: return None
    mo, d, y, h, mi, s = [int(x) for x in m.groups()]
    try: return datetime(y+2000, mo, d, h, mi, s)
    except: return None

files = sorted(os.listdir(FUNDS_DIR))
cutoff = datetime.now() - timedelta(days=MONTHS*30)
recent = [(d, f) for f in files if (d := parse_date(f)) and d >= cutoff]
recent.sort()
sampled, last = [], None
for d, f in recent:
    if last is None or (d - last).total_seconds() >= 4*3600:
        sampled.append((d, f)); last = d

ch_hist = defaultdict(list)
for d, f in sampled:
    try:
        with open(os.path.join(FUNDS_DIR, f)) as fh: data = json.load(fh)
    except: continue
    for ch in data.get("channels", []):
        scid = ch.get("short_channel_id", "")
        if scid: ch_hist[scid].append((d, ch["our_amount_msat"], ch["amount_msat"], ch.get("state","")))

r = subprocess.run(["docker","exec","cl","lightning-cli","listpeerchannels"], capture_output=True, text=True, timeout=15)
peerchans = json.loads(r.stdout)

aliases = {}
def get_alias(pid):
    if pid in aliases: return aliases[pid]
    try:
        r2 = subprocess.run(["docker","exec","cl","lightning-cli","listnodes",pid], capture_output=True, text=True, timeout=10)
        nd = json.loads(r2.stdout)
        a = nd["nodes"][0].get("alias", pid[:20]) if nd.get("nodes") else pid[:20]
    except: a = pid[:20]
    aliases[pid] = a; return a

cands = []
for ch in peerchans.get("channels", []):
    scid = ch.get("short_channel_id",""); state = ch.get("state","")
    if not scid or state != "CHANNELD_NORMAL": continue
    cap = ch.get("total_msat",0)//1000; loc = ch.get("to_us_msat",0)//1000
    if cap == 0: continue
    pct = 100*loc/cap
    if pct < MIN_LOCAL_PCT: continue
    hist = ch_hist.get(scid, [])
    norm = [(d,o,t) for d,o,t,s in hist if s=="CHANNELD_NORMAL"]
    mv = sum(abs(norm[i][1]-norm[i-1][1]) for i in range(1,len(norm)))//1000 if len(norm)>=2 else 0
    cands.append({"scid":scid,"peer_id":ch.get("peer_id",""),"movement":mv})

cands.sort(key=lambda x: x["movement"])
sel = []
for c in cands:
    if len(sel) >= COUNT: break
    alias = get_alias(c["peer_id"])
    skip = any(e in c["scid"].lower() or e in alias.lower() for e in EXCLUDE)
    if not skip: sel.append(c["scid"])

print(" ".join(sel))
PYEOF
)

if [[ "$EXECUTE" != "true" ]]; then
  echo ""
  echo "DRY RUN - to actually close, run:"
  echo "  $0 --execute"
  exit 0
fi

echo ""
echo "Closing channels..."
for scid in $SCIDS; do
  echo "  Closing $scid ..."
  docker exec cl lightning-cli close "$scid" "$CLOSE_TIMEOUT" 2>&1 | head -5
  echo ""
done

echo "Done."
