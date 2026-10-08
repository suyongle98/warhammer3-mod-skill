@echo off
node "%~dp0extract.js" %*
exit /b %errorlevel%
