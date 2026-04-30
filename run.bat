@echo off
REM Stock Research Lite - one-click launcher
REM Starts the Flask backend (port 5001) and the static frontend (port 8000),
REM then opens the site in your default browser.

setlocal
cd /d "%~dp0"

REM --- Bootstrap .env from .env.example on first run ---
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        echo [setup] Creating backend\.env from .env.example...
        copy /Y "backend\.env.example" "backend\.env" >nul
    ) else (
        echo [error] backend\.env.example not found.
        pause
        exit /b 1
    )
)

REM --- Ensure backend venv exists and dependencies are installed ---
if not exist "backend\venv\Scripts\python.exe" (
    echo [setup] Creating Python virtual environment...
    python -m venv backend\venv
    if errorlevel 1 (
        echo [error] Failed to create venv. Make sure Python is installed and on PATH.
        echo         Download Python from https://www.python.org/downloads/
        pause
        exit /b 1
    )
    echo [setup] Installing requirements (this takes a minute on first run)...
    "backend\venv\Scripts\python.exe" -m pip install --upgrade pip >nul
    "backend\venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
)

REM --- Start backend in its own window ---
echo [run] Starting backend on http://localhost:5001 ...
start "Stock Research - Backend" cmd /k ""backend\venv\Scripts\python.exe" backend\app.py"

REM --- Give the backend a moment to bind ---
timeout /t 3 /nobreak >nul

REM --- Start frontend in its own window ---
echo [run] Starting frontend on http://localhost:8000 ...
start "Stock Research - Frontend" cmd /k "python -m http.server 8000 --directory frontend"

REM --- Give the frontend a moment, then open the browser ---
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"

echo.
echo Both servers are running in separate windows.
echo Close those windows to stop the servers.
echo.
endlocal
