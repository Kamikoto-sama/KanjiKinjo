#!/usr/bin/env bash
set -eu

cd -- "$(dirname -- "$0")/.."

if [[ ! -x server/.venv/bin/uvicorn ]] || ! command -v npm >/dev/null; then
    printf '%s\n' 'Install the local development dependencies listed in README.md first.' >&2
    exit 1
fi

set -m
api_pid=
frontend_pid=
cleanup() {
    trap '' INT TERM
    for pid in "$api_pid" "$frontend_pid"; do
        if [[ -n "$pid" ]]; then
            kill -TERM -- "-$pid" 2>/dev/null || true
        fi
    done
    wait
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

server/.venv/bin/uvicorn server.main:app --reload --host 127.0.0.1 --port 8001 </dev/null &
api_pid=$!
KANJIGRAPH_API_TARGET=http://127.0.0.1:8001 npm --prefix frontend run dev -- --port 5173 --strictPort </dev/null &
frontend_pid=$!

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
    sleep 1
done

if kill -0 "$api_pid" 2>/dev/null; then
    wait "$frontend_pid"
else
    wait "$api_pid"
fi
