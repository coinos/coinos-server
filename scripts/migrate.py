#!/usr/bin/env python3
"""Migrate CLN SQLite database to Postgres.

Reads from /tmp/lightningd.sqlite3, outputs SQL to stdout.
Run inside the pgcl container:
  python3 /tmp/migrate.py | psql -U lightning -d lightning
"""
import sqlite3
import subprocess
import sys

sq = sqlite3.connect("/tmp/lightningd.sqlite3")
sq.row_factory = sqlite3.Row

# Get Postgres tables
r = subprocess.run(
    ["psql", "-U", "lightning", "-d", "lightning", "-tAc",
     "SELECT tablename FROM pg_tables WHERE schemaname='public';"],
    capture_output=True, text=True
)
pg_tables = set(r.stdout.strip().split("\n"))

# Get SQLite tables
sq_tables = [row[0] for row in sq.execute(
    "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

sql_parts = [
    "BEGIN;",
    "SET CONSTRAINTS ALL DEFERRED;",
]
total = 0

# Insert tables with foreign key targets first
priority = ["version", "blocks", "shachains", "peers", "channels",
            "channel_configs", "offers", "invoicerequests", "move_accounts"]
ordered = priority + [t for t in sq_tables if t not in priority]

for tbl in ordered:
    if tbl not in pg_tables:
        print(f"  SKIP {tbl}", file=sys.stderr)
        continue

    rows = sq.execute(f'SELECT * FROM [{tbl}]').fetchall()
    if not rows:
        print(f"  {tbl}: 0 rows", file=sys.stderr)
        continue

    cols = rows[0].keys()
    col_list = ", ".join(f'"{c}"' for c in cols)
    count = 0

    for row in rows:
        values = []
        for col in cols:
            val = row[col]
            if val is None:
                values.append("NULL")
            elif isinstance(val, bytes):
                values.append(f"'\\x{val.hex()}'")
            elif isinstance(val, (int, float)):
                values.append(str(val))
            else:
                escaped = str(val).replace("'", "''")
                values.append(f"'{escaped}'")
        val_list = ", ".join(values)
        sql_parts.append(f'INSERT INTO "{tbl}" ({col_list}) VALUES ({val_list});')
        count += 1

    total += count
    print(f"  {tbl}: {count} rows", file=sys.stderr)

sql_parts.append("COMMIT;")
print(f"\nTotal: {total} rows to migrate", file=sys.stderr)
print("\n".join(sql_parts))
