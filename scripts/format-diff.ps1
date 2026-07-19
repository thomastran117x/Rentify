param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDir
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$changedFiles = @(
  git diff --name-only --diff-filter=ACMR -- $PackageDir
  git diff --cached --name-only --diff-filter=ACMR -- $PackageDir
  git ls-files --others --exclude-standard -- $PackageDir
) |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ } |
  Sort-Object -Unique

if (-not $changedFiles) {
  Write-Host "No changed files to format in $PackageDir."
  exit 0
}

& npx --yes prettier@3.6.2 --write --ignore-unknown @changedFiles
exit $LASTEXITCODE
