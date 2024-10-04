#!/bin/bash

# Check if the socket file exists
if [ -S /sockets/ctrl ]; then
  echo "Socket exists. Unlinking..."
  rm /sockets/ctrl
fi

# Start socat
socat UNIX-LISTEN:/sockets/ctrl,reuseaddr,fork SYSTEM:'sh -c "cat | while read line; do output=\$(eval \$line 2>&1); echo \$output; done"'

