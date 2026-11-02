$ErrorActionPreference = 'Stop'
$expected = '930a7c75ee884603890d41fec4127fb49fac265ab6a8f0818f7a8b733c814661'
$source = Join-Path $PSScriptRoot 'F1.xlsx'
$target = Join-Path $PSScriptRoot 'data\original\F1.xlsx'
$checksum = Join-Path $PSScriptRoot 'data\original\F1.xlsx.sha256'

if (-not (Test-Path -LiteralPath $source)) { throw "F1.xlsx must be beside this script. Extract the ZIP into the project root." }
if (-not (Test-Path -LiteralPath (Split-Path $target -Parent))) { throw "Cannot find data\original. Extract the ZIP into the project root." }
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne $expected) { throw "The supplied workbook hash is unexpected: $sourceHash. No files changed." }

$backup = "$target.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $target -Destination $backup
Copy-Item -LiteralPath $source -Destination $target -Force
$installedHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -ne $expected) { throw "Installed hash mismatch. Backup preserved at $backup" }
$checksumHash = (Get-Content -LiteralPath $checksum -Raw).Trim().ToLowerInvariant()
if ($checksumHash -ne $expected) { Set-Content -LiteralPath $checksum -Value $expected -NoNewline }
Write-Host 'SUCCESS: restored the workbook version expected by the Stage 2 tests.' -ForegroundColor Green
Write-Host "SHA-256: $installedHash"
Write-Host "Backup: $backup"
Write-Host 'Next run: npm test'
