#!/bin/sh
# Start the PO-token provider in the background, then the app.
node /opt/bgutil/server/build/main.js >/tmp/bgutil.log 2>&1 &
exec node /app/server.js
