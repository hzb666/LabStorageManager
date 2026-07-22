[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version
)

Set-StrictMode -Version Latest
$python = Get-Command python -ErrorAction Stop
$versionScript = Join-Path $PSScriptRoot "release_version.py"

& $python.Source $versionScript set $Version
exit $LASTEXITCODE
