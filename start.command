#!/bin/bash
# XO LAB — double-click to run on a Mac. Opens http://localhost:8080 in your browser.
cd "$(dirname "$0")"
PORT=8080
URL="http://localhost:$PORT/"
openlater() { sleep 1.5; open "$URL"; }
echo "XO LAB → $URL   (close this window to stop)"
if command -v node >/dev/null 2>&1; then openlater & exec node scripts/serve.mjs $PORT
elif command -v ruby >/dev/null 2>&1; then openlater & exec ruby -run -e httpd . -p $PORT
elif xcode-select -p >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then openlater & exec python3 -m http.server $PORT
else
  echo "No local web server found — opening the file directly (everything except installing works)."
  open index.html
fi
