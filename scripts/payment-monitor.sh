#!/bin/bash
# Payment failure monitor for coinos-server
# Watches app container logs and compiles failure analytics
# Run: ./scripts/payment-monitor.sh [hours_to_watch]
# Output: periodic reports to stdout + detailed data to /tmp/payment-failures.jsonl

WATCH_HOURS=${1:-24}
DATA_FILE="/tmp/payment-failures.jsonl"
REPORT_INTERVAL=1800  # report every 30 min
NODE_ID=$(docker exec cl lightning-cli getinfo 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "unknown")

echo "Payment failure monitor started (watching for ${WATCH_HOURS}h)"
echo "Node: ${NODE_ID}"
echo "Data file: ${DATA_FILE}"
echo "Reports every ${REPORT_INTERVAL}s"
echo "---"

# Clear old data
> "$DATA_FILE"

docker logs app -f 2>&1 | timeout $((WATCH_HOURS * 3600)) python3 -u -c "
import sys, json, time, re
from collections import Counter, defaultdict
from datetime import datetime

data_file = '${DATA_FILE}'
report_interval = ${REPORT_INTERVAL}
last_report = time.time()

# Tracking
failures = []
error_types = Counter()
failed_destinations = Counter()
failed_channels = Counter()  # channels that return temporary_channel_failure
fee_insufficient_channels = Counter()
failed_amounts = []  # (amount, error_type)
successful = 0
total_attempts = 0

prev_line = None

def parse_failure(line, error_line):
    global successful, total_attempts
    total_attempts += 1

    try:
        msg = json.loads(line)['msg']
        err_msg = json.loads(error_line)['msg'] if error_line else ''
    except:
        return

    # Parse: username payment failed amount balance hash
    m = re.match(r'(\S+) payment failed (\d+) (\d+)\s+(.*)', msg)
    if not m:
        return

    username, amount, balance, rest = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)

    # Categorize error
    if 'Insufficient funds' in err_msg or 'insuficientes' in err_msg.lower():
        etype = 'insufficient_funds'
    elif 'excessive cost' in err_msg:
        etype = 'excessive_cost'
    elif 'temporary_channel_failure' in err_msg:
        etype = 'temporary_channel_failure'
        # Extract failed channel IDs
        for ch in re.findall(r'(\d+x\d+x\d+/\d+)', err_msg):
            failed_channels[ch] += 1
    elif 'fee_insufficient' in err_msg:
        etype = 'fee_insufficient'
        for ch in re.findall(r'(\d+x\d+x\d+/\d+)', err_msg):
            fee_insufficient_channels[ch] += 1
    elif 'Timed out' in err_msg:
        etype = 'timed_out'
        for ch in re.findall(r'(\d+x\d+x\d+/\d+)', err_msg):
            if 'temporary_channel_failure' in err_msg:
                failed_channels[ch] += 1
            if 'fee_insufficient' in err_msg:
                fee_insufficient_channels[ch] += 1
    elif 'Cannot send to self' in err_msg:
        etype = 'self_pay'
    elif 'incorrect_or_unknown' in err_msg:
        etype = 'unknown_invoice'
    elif 'already underway' in err_msg:
        etype = 'already_underway'
    elif 'already been paid' in err_msg:
        etype = 'already_paid'
    elif 'user not provided' in err_msg:
        etype = 'user_not_found'
    elif err_msg:
        etype = err_msg[:80]
    else:
        etype = 'unknown'

    error_types[etype] += 1
    failed_amounts.append((amount, etype))

    # Try to get destination from invoice
    if rest and rest.startswith('ln'):
        bolt11_prefix = rest[:20]
        failed_destinations[bolt11_prefix] += 1

    record = {
        'time': datetime.utcnow().isoformat(),
        'user': username,
        'amount': amount,
        'balance': balance,
        'error': etype,
        'detail': err_msg[:200] if err_msg else '',
    }

    with open(data_file, 'a') as f:
        f.write(json.dumps(record) + '\n')

def parse_success(line):
    global successful
    successful += 1

def report():
    global last_report
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    print(f'\n====== PAYMENT FAILURE REPORT {now} UTC ======')
    print(f'Total attempts: {total_attempts}  Successful: {successful}  Failed: {total_attempts}')
    if total_attempts > 0:
        print(f'Success rate: {successful/(successful+total_attempts)*100:.1f}%')

    print(f'\n--- Error breakdown ---')
    for etype, count in error_types.most_common(15):
        print(f'  {count:>5}  {etype}')

    if failed_channels:
        print(f'\n--- Channels with liquidity failures (top 10) ---')
        for ch, count in failed_channels.most_common(10):
            print(f'  {count:>5}  {ch}')

    if fee_insufficient_channels:
        print(f'\n--- Channels with stale fee gossip (top 10) ---')
        for ch, count in fee_insufficient_channels.most_common(10):
            print(f'  {count:>5}  {ch}')

    # Amount distribution of failures
    if failed_amounts:
        amounts_by_type = defaultdict(list)
        for amt, etype in failed_amounts:
            amounts_by_type[etype].append(amt)

        print(f'\n--- Failed amount ranges by error ---')
        for etype in ['insufficient_funds', 'excessive_cost', 'temporary_channel_failure', 'timed_out', 'fee_insufficient']:
            amts = amounts_by_type.get(etype, [])
            if amts:
                print(f'  {etype}: min={min(amts)} max={max(amts)} avg={sum(amts)//len(amts)} count={len(amts)}')

    print(f'\n--- Recommendations ---')
    if error_types.get('insufficient_funds', 0) > 10:
        print('  * HIGH insufficient_funds: Consider showing fee preview before payment attempt')
    if error_types.get('excessive_cost', 0) > 5:
        print('  * HIGH excessive_cost: Increase default maxfee or improve channel connectivity')
    if error_types.get('fee_insufficient', 0) > 5:
        print('  * STALE GOSSIP: Some channels advertise lower fees than they charge')
        print('    Nodes to investigate:')
        for ch, count in fee_insufficient_channels.most_common(5):
            scid = ch.split('/')[0]
            print(f'      {scid} ({count} failures)')
    if failed_channels:
        print('  * LIQUIDITY BOTTLENECKS:')
        for ch, count in failed_channels.most_common(5):
            if count >= 3:
                scid = ch.split('/')[0]
                print(f'      {scid} ({count} failures) - consider opening channel to bypass')
    if error_types.get('self_pay', 0) > 5:
        print('  * SELF-PAY: Users trying to pay own invoices - consider UI guard')

    print('=' * 55)
    sys.stdout.flush()
    last_report = time.time()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    try:
        d = json.loads(line)
        msg = d.get('msg', '')
    except:
        prev_line = line
        continue

    # Track successes
    if 'sent lightning' in msg or 'sent liquid' in msg or 'sent bitcoin' in msg:
        parse_success(line)

    # Track failures - need the next line for error detail
    if prev_line and 'payment failed' in prev_line:
        try:
            prev_d = json.loads(prev_line)
            if 'payment failed' in prev_d.get('msg', ''):
                parse_failure(prev_line, line)
        except:
            pass

    prev_line = line

    # Periodic report
    if time.time() - last_report >= report_interval:
        report()
" 2>&1

echo "Monitor finished after ${WATCH_HOURS}h"
