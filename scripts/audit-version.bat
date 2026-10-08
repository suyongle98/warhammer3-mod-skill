@echo off
node "%~dp0audit-version.js" %*
exit /b %errorlevel%
