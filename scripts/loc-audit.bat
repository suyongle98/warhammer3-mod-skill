@echo off
node "%~dp0loc-audit.js" %*
exit /b %errorlevel%
