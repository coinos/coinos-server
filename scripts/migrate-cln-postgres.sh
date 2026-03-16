#!/bin/bash
set -e

# CLN SQLite → Postgres migration
# Copies all data from the running CLN SQLite database into Postgres,
# then switches CLN to use Postgres as its backend.
#
# Prerequisites: pgcl container running, cl container running with SQLite

DB="/root/.lightning/regtest/lightningd.sqlite3"
PG="postgres://lightning:lightning@pgcl:5432/lightning"

echo "=== CLN SQLite → Postgres Migration ==="
echo ""

# ── 1. Verify current state ─────────────────────────────────────────
echo "1. Current CLN state (SQLite):"
docker exec cl lightning-cli getinfo 2>&1 | grep -E '"id"|"num_peers"|"num_active_channels"' || true
echo ""

# ── 2. Stop CLN ─────────────────────────────────────────────────────
echo "2. Stopping CLN..."
docker compose stop cl
sleep 2
echo ""

# ── 3. Ensure Postgres is up ────────────────────────────────────────
echo "3. Ensuring Postgres is ready..."
docker compose up -d pgcl
until docker exec pgcl pg_isready -U lightning > /dev/null 2>&1; do sleep 1; done
echo "   Ready"
echo ""

# ── 4. Create Postgres schema via temp CLN ──────────────────────────
echo "4. Creating Postgres schema..."
docker exec pgcl psql -U lightning -d postgres -c "DROP DATABASE IF EXISTS lightning;" > /dev/null 2>&1
docker exec pgcl psql -U lightning -d postgres -c "CREATE DATABASE lightning;" > /dev/null 2>&1

# Use a temp CLN instance to create the schema
rm -rf /tmp/cln-schema-seed
mkdir -p /tmp/cln-schema-seed
cat > /tmp/cln-schema-seed/config << 'CONF'
network=regtest
bitcoin-rpcconnect=bc
bitcoin-rpcport=18443
bitcoin-rpcuser=admin1
bitcoin-rpcpassword=123
wallet=postgres://lightning:lightning@pgcl:5432/lightning
database-upgrade=true
developer
CONF

docker run -d --name cln-schema --network net \
  -e LIGHTNINGD_NETWORK=regtest \
  -v /tmp/cln-schema-seed:/root/.lightning \
  elementsproject/lightningd:v25.12.1 > /dev/null 2>&1
sleep 10

TABLES=$(docker exec pgcl psql -U lightning -d lightning -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
docker stop cln-schema > /dev/null 2>&1 && docker rm cln-schema > /dev/null 2>&1
rm -rf /tmp/cln-schema-seed

echo "   Created $TABLES tables"
echo ""

# ── 5. Truncate all Postgres tables (remove seed data) ──────────────
echo "5. Clearing seed data from Postgres..."
docker exec pgcl psql -U lightning -d lightning -tAc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public';" | while read tbl; do
  docker exec pgcl psql -U lightning -d lightning -c "TRUNCATE \"$tbl\" CASCADE;" > /dev/null 2>&1
done
echo "   Done"
echo ""

# ── 6. Install tools ────────────────────────────────────────────────
echo "6. Installing migration tools..."
docker exec pgcl apt-get update -qq > /dev/null 2>&1
docker exec pgcl apt-get install -y -qq sqlite3 python3 > /dev/null 2>&1
echo "   Done"
echo ""

# ── 7. Copy SQLite file into pgcl container ─────────────────────────
echo "7. Copying SQLite database..."
docker cp "$(docker inspect cl --format '{{.GraphDriver.Data.MergedDir}}')/root/.lightning/regtest/lightningd.sqlite3" /tmp/lightningd.sqlite3 2>/dev/null \
  || docker exec cl cat "$DB" > /tmp/lightningd.sqlite3
docker cp /tmp/lightningd.sqlite3 pgcl:/tmp/lightningd.sqlite3
echo "   Done"
echo ""

# ── 8. Run migration ────────────────────────────────────────────────
echo "8. Migrating data..."

docker exec pgcl bash -c 'cat > /tmp/migrate.py << '"'"'PYEOF'"'"'
import sqlite3, subprocess, json, sys

sq = sqlite3.connect("/tmp/lightningd.sqlite3")
sq.row_factory = sqlite3.Row

# Get table list from Postgres
result = subprocess.run(
    ["psql", "-U", "lightning", "-d", "lightning", "-tAc",
     "SELECT tablename FROM pg_tables WHERE schemaname='"'"'public'"'"';"],
    capture_output=True, text=True
)
pg_tables = set(result.stdout.strip().split("\n"))

# Get table list from SQLite
sq_tables = [r[0] for r in sq.execute(
    "SELECT name FROM sqlite_master WHERE type='"'"'table'"'"' ORDER BY name").fetchall()]

total = 0
errors = []

for tbl in sq_tables:
    if tbl not in pg_tables:
        print(f"  SKIP {tbl} (not in Postgres schema)")
        continue

    rows = sq.execute(f"SELECT * FROM [{tbl}]").fetchall()
    if not rows:
        continue

    cols = rows[0].keys()
    ncols = len(cols)

    # Get Postgres column types
    type_result = subprocess.run(
        ["psql", "-U", "lightning", "-d", "lightning", "-tAc",
         f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='"'"'{tbl}'"'"' ORDER BY ordinal_position;"],
        capture_output=True, text=True
    )
    pg_types = {}
    for line in type_result.stdout.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            pg_types[parts[0].strip()] = parts[1].strip()

    count = 0
    for row in rows:
        values = []
        for col in cols:
            val = row[col]
            if val is None:
                values.append("NULL")
            elif isinstance(val, bytes):
                hex_str = val.hex()
                values.append(f"'"'"'\\x{hex_str}'"'"'::bytea")
            elif isinstance(val, int):
                values.append(str(val))
            elif isinstance(val, float):
                values.append(str(val))
            else:
                escaped = str(val).replace("'"'"'", "'"'"''"'"'")
                values.append(f"'"'"'{escaped}'"'"'")

        col_list = ", ".join(f'"{c}"' for c in cols)
        val_list = ", ".join(values)
        sql = f"INSERT INTO \"{tbl}\" ({col_list}) VALUES ({val_list});"

        result = subprocess.run(
            ["psql", "-U", "lightning", "-d", "lightning", "-c", sql],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            err = result.stderr.strip()
            if "duplicate key" not in err:
                errors.append(f"{tbl}: {err[:120]}")
                break
        count += 1

    total += count
    print(f"  {tbl}: {count} rows")

print(f"\nTotal: {total} rows migrated")
if errors:
    print(f"\nErrors ({len(errors)}):")
    for e in errors:
        print(f"  {e}")
    sys.exit(1)
PYEOF
python3 /tmp/migrate.py'

echo ""

# ── 9. Verify row counts ────────────────────────────────────────────
echo "9. Verifying migration..."
echo "   Key table row counts (SQLite → Postgres):"
for tbl in version channels peers outputs payments invoices vars datastore; do
  SQ=$(docker exec pgcl sqlite3 /tmp/lightningd.sqlite3 "SELECT COUNT(*) FROM $tbl;" 2>/dev/null)
  PG=$(docker exec pgcl psql -U lightning -d lightning -tAc "SELECT COUNT(*) FROM \"$tbl\";" 2>/dev/null)
  STATUS="✓"
  [ "$SQ" != "$PG" ] && STATUS="✗"
  echo "   $STATUS $tbl: $SQ → $PG"
done
echo ""

# ── 10. Switch CLN config to Postgres ────────────────────────────────
echo "10. Switching CLN config to Postgres..."
CONFIG_FILE="data/lightning/config"
if ! grep -q "^wallet=postgres" "$CONFIG_FILE"; then
  sed -i '/^developer/i wallet=postgres://lightning:lightning@pgcl:5432/lightning' "$CONFIG_FILE"
fi
echo "   Config updated"
echo ""

# ── 11. Start CLN on Postgres ───────────────────────────────────────
echo "11. Starting CLN with Postgres backend..."
docker compose up -d cl
sleep 8

for i in $(seq 1 20); do
  if docker exec cl lightning-cli getinfo > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo ""
echo "=== Post-migration verification ==="
docker exec cl lightning-cli getinfo 2>&1 | grep -E '"id"|"num_peers"|"num_active_channels"|"blockheight"'
echo ""
echo "Funds:"
docker exec cl lightning-cli listfunds 2>&1 | jq '{outputs: (.outputs | length), channels: (.channels | length), total_sats: ([.outputs[].amount_msat] | add / 1000)}'
echo ""
echo "=== Migration complete ==="
