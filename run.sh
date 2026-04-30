#!/usr/bin/env bash
# Stock Research Lite - one-click launcher (Mac / Linux)
# Starts the Flask backend (port 5001) and the static frontend (port 8000),
# then opens the site in the default browser.

set -e
cd "$(dirname "$0")"

# Bootstrap .env from .env.example on first run
if [ ! -f backend/.env ]; then
  if [ -f backend/.env.example ]; then
    echo "[setup] Creating backend/.env from .env.example..."
    cp backend/.env.example backend/.env
  else
    echo "[error] backend/.env.example not found." >&2
    exit 1
  fi
fi

# Create venv + install requirements on first run
if [ ! -x backend/venv/bin/python ]; then
  echo "[setup] Creating Python virtual environment..."
  python3 -m venv backend/venv
  echo "[setup] Installing requirements..."
  backend/venv/bin/python -m pip install --upgrade pip >/dev/null
  backend/venv/bin/python -m pip install -r backend/requirements.txt
fi

# Start backend in background
echo "[run] Starting backend on http://localhost:5001 ..."
backend/venv/bin/python backend/app.py &
BACKEND_PID=$!

trap "echo; echo 'Stopping servers...'; kill $BACKEND_PID 2>/dev/null; exit 0" INT TERM

sleep 3

# Open browser (best-effort)
if command -v open >/dev/null 2>&1; then
  open "http://localhost:8000" &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:8000" >/dev/null 2>&1 &
fi

# Run frontend in foreground (Ctrl+C will stop both)
echo "[run] Starting frontend on http://localhost:8000 ..."
echo "Press Ctrl+C to stop both servers."
python3 -m http.server 8000 --directory frontend
