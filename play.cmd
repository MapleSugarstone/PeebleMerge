@echo off
rem Serve Peeble Merge on http://localhost:8765 and open it in the default browser. Close this window to stop it.
setlocal
cd /d "%~dp0"
set PORT=8765

rem Reuse a server that is already listening on the port.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/
  exit /b 0
)

set PY=
where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py -3
if not defined PY (
  echo Python was not found. Install Python 3 from python.org, then run this again.
  pause
  exit /b 1
)

echo Peeble Merge: http://localhost:%PORT%/
echo Close this window to stop the server.
start "" http://localhost:%PORT%/
%PY% "Notes\tools\serve.py" %PORT%
