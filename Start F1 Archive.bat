
@echo off
title F1 Career Archive

cd /d "%~dp0server"
start "" /min cmd /c "npm start"

timeout /t 3 /nobreak >nul

cd /d "%~dp0frontend"
start "" /min cmd /c "npm run dev"

timeout /t 3 /nobreak >nul

start "" http://localhost:5173

exit
