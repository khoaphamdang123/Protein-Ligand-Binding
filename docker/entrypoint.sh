#!/usr/bin/env bash
# Container start: the backend on 127.0.0.1:8000 and the web page + /api proxy on 0.0.0.0:$PORT.
# If either stops, the other is stopped too and the container exits with its code (docker restarts it if asked).
set -uo pipefail
cd /app

( cd backend && exec .venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 ) &
backend=$!
backend/.venv/bin/python scripts/serve_dist.py dist/bindsite-explorer/browser \
  --host 0.0.0.0 --port "${PORT:-8080}" --backend http://127.0.0.1:8000 &
frontend=$!
echo "BindSite Explorer: web page on port ${PORT:-8080} inside the container (models on ${BINDSITE_DEVICE:-cpu})"

stop() { kill -TERM "$backend" "$frontend" 2>/dev/null; }
trap 'stop; wait; exit 0' TERM INT
wait -n "$backend" "$frontend"
code=$?
echo "a server stopped (exit $code): stopping the container" >&2
stop
wait
exit "$code"
