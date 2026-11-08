#!/usr/bin/env bash
# Start / stop BindSite Explorer on this machine: backend (FastAPI, :8000) + frontend (built app with gzip, :4200).
#
#   bash scripts/app.sh start [--build]   build the frontend when the sources changed (or always with --build),
#                                         start both, wait until the models are loaded
#   bash scripts/app.sh stop | restart [--build] | status | logs
#
# Both run detached (setsid): they keep running after the terminal or the Claude session that started them closes.
# Everything runs on the CPU, never the GPU (the GPU of this machine belongs to other work): the prediction models
# (BINDSITE_DEVICE=cpu) and local ESMFold too (BINDSITE_DEVICE_ESMFOLD=cpu: ~20 GB of RAM, minutes per protein, folded
# in the background while the page waits). Open http://localhost:4200 (VS Code forwards the port).
# One-time setup: see README.md, "Khởi tạo app".
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$REPO/.run"
LOGS="$REPO/backend/logs"
PY="$REPO/backend/.venv/bin/python"
DIST="$REPO/dist/bindsite-explorer/browser"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4200}"
export BINDSITE_DEVICE="${BINDSITE_DEVICE:-cpu}"
export BINDSITE_DEVICE_ESMFOLD="${BINDSITE_DEVICE_ESMFOLD:-cpu}"
# This machine is borrowed for its CPU and RAM: the GPU belongs to other work, so the backend does not even see it.
export CUDA_VISIBLE_DEVICES=""
mkdir -p "$RUN" "$LOGS"

pid_of() {   # pid of our <name> process, or nothing
  local f="$RUN/$1.pid"
  [ -f "$f" ] || return 0
  local pid; pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null && grep -q "$2" "/proc/$pid/cmdline" 2>/dev/null; then echo "$pid"; else rm -f "$f"; fi
}

port_owner() { ss -ltnpH "sport = :$1" 2>/dev/null | sed -E 's/.*users:\(\("([^"]+)",pid=([0-9]+).*/\1 (pid \2)/' | head -1; }

check_port() {
  local owner; owner="$(port_owner "$1")"
  if [ -n "$owner" ]; then
    echo "!! port $1 is taken by $owner. Stop it, or choose another port: $2=<port> bash scripts/app.sh start" >&2
    exit 1
  fi
}

need_build() {
  [ -f "$DIST/index.html" ] || return 0
  [ -n "$(find "$REPO/src" "$REPO/public" "$REPO/angular.json" -newer "$DIST/index.html" -print -quit 2>/dev/null)" ]
}

start_backend() {
  if [ -n "$(pid_of backend uvicorn)" ]; then echo "backend already running (pid $(pid_of backend uvicorn))"; return; fi
  [ -x "$PY" ] || { echo "!! $PY missing: run bash backend/setup_env.sh first" >&2; exit 1; }
  check_port "$BACKEND_PORT" BACKEND_PORT
  ( cd "$REPO/backend" && exec setsid nohup "$PY" -m uvicorn app.main:create_app --factory --host 127.0.0.1 \
      --port "$BACKEND_PORT" >> "$LOGS/backend.out" 2>&1 < /dev/null ) &
  echo $! > "$RUN/backend.pid"
  echo "backend  started (pid $!, models on $BINDSITE_DEVICE), log backend/logs/backend.log"
}

start_frontend() {
  if [ -n "$(pid_of frontend serve_dist)" ]; then echo "frontend already running (pid $(pid_of frontend serve_dist))"; return; fi
  if [ "${BUILD:-0}" = 1 ] || need_build; then
    echo "building the frontend (npx ng build, ~40 s)"
    ( cd "$REPO" && npx ng build > "$LOGS/frontend-build.log" 2>&1 ) || { echo "!! build failed, see backend/logs/frontend-build.log" >&2; exit 1; }
  fi
  check_port "$FRONTEND_PORT" FRONTEND_PORT
  ( cd "$REPO" && exec setsid nohup "$PY" scripts/serve_dist.py "$DIST" --port "$FRONTEND_PORT" \
      --backend "http://127.0.0.1:$BACKEND_PORT" >> "$LOGS/frontend.out" 2>&1 < /dev/null ) &
  echo $! > "$RUN/frontend.pid"
  echo "frontend started (pid $!)"
}

wait_ready() {
  local i health
  for i in $(seq 1 120); do
    health="$(curl -s -m 3 "http://127.0.0.1:$FRONTEND_PORT/api/health" || true)"
    if echo "$health" | grep -q '"self_test":"\(ok\|error\|warning\)"'; then break; fi
    sleep 2
  done
  status
}

stop_one() {
  local pid; pid="$(pid_of "$1" "$2")"
  if [ -z "$pid" ]; then echo "$1 not running"; return; fi
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid"
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$pid" 2>/dev/null && { kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid"; }
  rm -f "$RUN/$1.pid"
  echo "$1 stopped"
}

status() {
  local b f
  b="$(pid_of backend uvicorn)"; f="$(pid_of frontend serve_dist)"
  echo "backend : $([ -n "$b" ] && echo "running, pid $b" || echo stopped)   http://127.0.0.1:$BACKEND_PORT"
  echo "frontend: $([ -n "$f" ] && echo "running, pid $f" || echo stopped)   http://localhost:$FRONTEND_PORT  (Explore, Predict)"
  [ -n "$b" ] || return 0
  HEALTH="$(curl -s -m 5 "http://127.0.0.1:$BACKEND_PORT/health" || true)" "$PY" - <<'PYEOF'
import json, os
try:
    h = json.loads(os.environ["HEALTH"])
except Exception:
    raise SystemExit("health  : no answer yet")
devices = sorted({v for k, v in h.get("devices", {}).items() if k != "esmfold"})
src = h.get("structure_sources", {})
print(f"health  : {h.get('status')} | models {h.get('predictor')} on {', '.join(devices)} | self-test {h.get('self_test')}"
      f" | compare {'on' if h.get('compare') else 'off'}")
local = src.get("local", {})
print(f"structure: {src.get('precomputed', {}).get('count', 0)} cached -> ESMFold API -> local ESMFold on "
      f"{local.get('device', '?')} ({local.get('state', 'off')}) -> upload")
PYEOF
}

cmd="${1:-status}"; shift || true
[ "${1:-}" = "--build" ] && BUILD=1
case "$cmd" in
  start)   start_backend; start_frontend; wait_ready ;;
  stop)    stop_one frontend serve_dist; stop_one backend uvicorn ;;
  restart) stop_one frontend serve_dist; stop_one backend uvicorn; start_backend; start_frontend; wait_ready ;;
  status)  status ;;
  logs)    tail -n 40 "$LOGS/backend.log" "$LOGS/frontend.out" ;;
  *)       sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 2 ;;
esac
