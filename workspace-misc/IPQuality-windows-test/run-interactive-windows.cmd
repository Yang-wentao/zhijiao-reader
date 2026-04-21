@echo off
setlocal

pushd "%~dp0" >nul 2>nul || (
echo.
echo Could not open the script folder.
echo Copy this folder to a local path such as Desktop, then run it again.
echo.
pause >nul
exit /b 1
)

set "SCRIPT_DIR=%CD%"
set "SCRIPT_DIR_UNIX=%SCRIPT_DIR:\=/%"
set "IPQ_ARGS=-p -n %*"
set "EXIT_CODE=0"

call :run_git_bash "%ProgramFiles%\Git\bin\bash.exe"
if not errorlevel 1 goto :eof

call :run_git_bash "%ProgramFiles(x86)%\Git\bin\bash.exe"
if not errorlevel 1 goto :eof

call :run_wsl
if not errorlevel 1 goto :eof

echo.
echo Could not find Git Bash or WSL.
echo Install Git for Windows or enable WSL, then run this script again.
echo.
pause >nul
popd >nul
exit /b 1

:run_git_bash
set "GIT_BASH=%~1"
if not exist "%GIT_BASH%" exit /b 1

echo Starting IPQuality with Git Bash...
"%GIT_BASH%" --login -i -c "cd '%SCRIPT_DIR_UNIX%' && bash ./ip.sh %IPQ_ARGS%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause >nul
popd >nul
exit /b %EXIT_CODE%

:run_wsl
where wsl.exe >nul 2>nul || exit /b 1

echo Starting IPQuality with WSL...
wsl.exe bash -lc "cd \"$(wslpath '%SCRIPT_DIR_UNIX%')\" && bash ./ip.sh %IPQ_ARGS%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause >nul
popd >nul
exit /b %EXIT_CODE%
