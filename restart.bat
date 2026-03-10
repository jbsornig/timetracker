@echo off
echo Stopping existing Node processes...
taskkill /F /IM node.exe 2>nul

echo Waiting for processes to stop...
timeout /t 2 /nobreak >nul

echo Starting backend server...
start "TimeTracker Server" cmd /k "cd /d "%~dp0server" && node index.js"

echo Starting frontend...
start "TimeTracker Client" cmd /k "cd /d "%~dp0client" && npm start"

echo.
echo Both server and client are starting in separate windows.
echo - Backend: http://localhost:3001
echo - Frontend: http://localhost:3000
