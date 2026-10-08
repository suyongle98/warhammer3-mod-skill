@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-tsv.ps1" %*
exit /b %errorlevel%
