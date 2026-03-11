@echo off
echo.
echo NOTE: Please manually close any existing TimeTracker server windows first.
echo       (Close the windows titled "TimeTracker Server" and "TimeTracker Client")
echo.
pause

echo Starting backend server...
start "TimeTracker Server" cmd /k "cd /d "%~dp0server" && node index.js"

echo Starting frontend...
start "TimeTracker Client" cmd /k "cd /d "%~dp0client" && npm start"

echo.
echo Both server and client are starting in separate windows.
echo - Backend: http://localhost:3001
echo - Frontend: http://localhost:3000
