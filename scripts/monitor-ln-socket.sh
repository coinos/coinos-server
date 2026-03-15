#!/usr/bin/env bash
set -euo pipefail

SOCKET_DIR="/home/adam/coinos-server/data/sockets"
SOCKET_MAIN="$SOCKET_DIR/lightning-rpc"
SOCKET_LISTEN="$SOCKET_DIR/lightning-rpc-listen"
REMOTE_SOCKET="/home/adam/coinos-server/data/lightning/bitcoin/lightning-rpc"
REMOTE_HOST="desk"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ln-socket-monitor] $*"
}

# Find SSH pids that are forwarding our sockets
pid_main=$(pgrep -f "ssh.*-L ${SOCKET_MAIN}:${REMOTE_SOCKET} ${REMOTE_HOST}" 2>/dev/null || true)
pid_listen=$(pgrep -f "ssh.*-L ${SOCKET_LISTEN}:${REMOTE_SOCKET} ${REMOTE_HOST}" 2>/dev/null || true)

# Check if both processes are alive and both sockets exist
if [[ -n "$pid_main" && -n "$pid_listen" && -S "$SOCKET_MAIN" && -S "$SOCKET_LISTEN" ]]; then
  exit 0
fi

# Something is wrong - log what we found
if [[ -z "$pid_main" ]]; then
  log "main SSH forward is dead"
elif [[ ! -S "$SOCKET_MAIN" ]]; then
  log "main socket file missing"
fi

if [[ -z "$pid_listen" ]]; then
  log "listen SSH forward is dead"
elif [[ ! -S "$SOCKET_LISTEN" ]]; then
  log "listen socket file missing"
fi

# Kill any remaining SSH forwards for our sockets
for pid in $pid_main $pid_listen; do
  if [[ -n "$pid" ]]; then
    log "killing stale SSH forward (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

# Brief wait for processes to exit
sleep 1

# Clean up socket files
for sock in "$SOCKET_MAIN" "$SOCKET_LISTEN"; do
  if [[ -e "$sock" ]]; then
    log "removing stale socket $sock"
    rm -f "$sock"
  fi
done

# Ensure socket directory exists
mkdir -p "$SOCKET_DIR"

# Re-establish both SSH forwards
log "starting main SSH forward"
ssh -nNT -o ExitOnForwardFailure=yes \
  -L "${SOCKET_MAIN}:${REMOTE_SOCKET}" "$REMOTE_HOST" &

log "starting listen SSH forward"
ssh -nNT -o ExitOnForwardFailure=yes \
  -L "${SOCKET_LISTEN}:${REMOTE_SOCKET}" "$REMOTE_HOST" &

# Wait briefly for sockets to appear
for i in 1 2 3 4 5; do
  if [[ -S "$SOCKET_MAIN" && -S "$SOCKET_LISTEN" ]]; then
    break
  fi
  sleep 1
done

# Set permissions on sockets
if [[ -S "$SOCKET_MAIN" ]]; then
  chmod 777 "$SOCKET_MAIN"
  log "set permissions on $SOCKET_MAIN"
else
  log "WARNING: $SOCKET_MAIN did not appear after 5s"
fi

if [[ -S "$SOCKET_LISTEN" ]]; then
  chmod 777 "$SOCKET_LISTEN"
  log "set permissions on $SOCKET_LISTEN"
else
  log "WARNING: $SOCKET_LISTEN did not appear after 5s"
fi

log "SSH forwards re-established"
