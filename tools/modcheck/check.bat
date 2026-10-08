@echo off
node "%~dp0check.js" %*
exit /b %errorlevel%
