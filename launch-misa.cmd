@echo off
pushd "%~dp0" || exit /b 1
start "" /b powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File ".\launch-misa.ps1" %*
set "exitCode=%ERRORLEVEL%"
popd
exit /b %exitCode%