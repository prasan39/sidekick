#!/bin/bash
# Start script that uses the native node binary instead of the Python wrapper.
# The Python-wrapped node (from pip nodejs-wheel) forwards signals incorrectly,
# causing SIGINT from unrelated terminal commands to kill the server.

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Prefer real node binary over the Python wrapper
if [ -x /usr/local/bin/node ]; then
  NODE=/usr/local/bin/node
elif [ -x /opt/homebrew/bin/node ]; then
  NODE=/opt/homebrew/bin/node
else
  NODE=node
fi

echo "[start.sh] Using node: $NODE ($($NODE --version))"

# Tell the server it's running in dev mode (ignore SIGINT)
export TSX_DEV=1
export CLEAR_HISTORY_ON_START=1

# Run node directly with tsx loader — NO tsx watch.
# tsx watch is an extra process layer that gets killed by stray SIGINTs.
# For file-watching, nodemon or manual restart is safer.
echo "[start.sh] Starting server (node --import tsx) ..."
exec "$NODE" --import tsx src/index.ts
