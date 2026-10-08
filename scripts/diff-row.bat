@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diff-row.ps1" %*
exit /b %errorlevel%
