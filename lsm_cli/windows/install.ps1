[CmdletBinding()]
param(
    [string]$SourceDir = "",
    [switch]$SkipPathUpdate
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $SourceDir) {
    $SourceDir = Join-Path $repoRoot "dist\lsm"
}

$resolvedSource = Resolve-Path $SourceDir -ErrorAction Stop
$targetDir = Join-Path $env:LOCALAPPDATA "LabStorageManager\bin\lsm"
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

# 目录版直接整体复制，避免单文件模式的临时解压目录。
robocopy $resolvedSource $targetDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) {
    throw "Failed copying files to $targetDir"
}

if (-not $SkipPathUpdate) {
    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $segments = @()
    if ($currentUserPath) {
        $segments = $currentUserPath -split ";" | Where-Object { $_ }
    }

    if ($segments -notcontains $targetDir) {
        $newPath = ($segments + $targetDir) -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Output "Added to user PATH: $targetDir"
    }
    else {
        Write-Output "User PATH already contains: $targetDir"
    }
}

Write-Output "Installed lsm to: $targetDir"
Write-Output "Open a new terminal and run: lsm auth login --username <user> --password-stdin"
