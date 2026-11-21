@echo off
REM fleet-run: start a worker without typing the long command.
REM
REM Reads JIRA_URL / JIRA_EMAIL / JIRA_TOKEN (and friends) from your environment
REM or from a .env file, asks Jira for the real customfield ids, then runs one
REM poll cycle. See TESTING.md section 5.7.
REM
REM   fleet-run.bat             one poll cycle
REM   fleet-run.bat --loop      poll forever
REM   fleet-run.bat --check     show what it would run, run nothing
REM   fleet-run.bat --verbose   show the resolved command

setlocal
set "HERE=%~dp0"
node "%HERE%bin\fleet-run.js" %*
exit /b %ERRORLEVEL%
