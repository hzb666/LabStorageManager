[CmdletBinding()]
param(
    [string]$Python = "python",
    [switch]$Clean
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$specPath = Join-Path $PSScriptRoot "lsm.spec"
$distPath = Join-Path $repoRoot "dist"
$buildPath = Join-Path $repoRoot "build"

if ($Clean) {
    # 目录版产物会被完整重建，清理旧目录可避免历史文件混入新分发包。
    if (Test-Path $distPath) {
        Remove-Item -LiteralPath $distPath -Recurse -Force
    }
    if (Test-Path $buildPath) {
        Remove-Item -LiteralPath $buildPath -Recurse -Force
    }
}

Push-Location $repoRoot
try {
    & $Python -m PyInstaller --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller is not available in the selected Python environment."
    }

    & $Python -m PyInstaller --noconfirm $specPath
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller build failed."
    }

    $outputDir = Join-Path $distPath "lsm"
    Write-Output "Build completed: $outputDir"
}
finally {
    Pop-Location
}
