# fleet-run: start a worker without typing the long command.
#
# Reads JIRA_URL / JIRA_EMAIL / JIRA_TOKEN (and friends) from your environment or
# from a .env file, asks Jira for the real customfield ids, then runs one poll
# cycle. See TESTING.md section 5.7.
#
#   .\fleet-run.ps1              one poll cycle
#   .\fleet-run.ps1 --loop       poll forever
#   .\fleet-run.ps1 --check      show what it would run, run nothing
#   .\fleet-run.ps1 --verbose    show the resolved command
#
# If PowerShell blocks it:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

& node (Join-Path $here 'bin\fleet-run.js') @args
exit $LASTEXITCODE
