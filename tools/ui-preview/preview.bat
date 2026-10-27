@echo off
node "%~dp0preview.js" %*
if errorlevel 1 pause
