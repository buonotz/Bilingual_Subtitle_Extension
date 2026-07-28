$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

$requiredIcons = @(
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
)

$missingIcons = @($requiredIcons | Where-Object {
  -not (Test-Path -LiteralPath (Join-Path $projectRoot $_))
})

if ($missingIcons.Count -gt 0) {
  throw "Missing required icon files: $($missingIcons -join ', '). See store/ASSETS.md."
}

if ($manifest.name -ne "__MSG_extensionNameBeta__") {
  throw "manifest.json must use the localized extensionNameBeta message."
}

$buildRoot = Join-Path $projectRoot "dist"
$stageRoot = Join-Path $buildRoot "beta-package"
$zipPath = Join-Path $buildRoot "streaming-bilingual-subtitles-$($manifest.version)-beta.zip"

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$runtimeFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "page-bridge.js"
)

foreach ($relativePath in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $stageRoot
}

Copy-Item -LiteralPath (Join-Path $projectRoot "_locales") -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "icons") -Destination $stageRoot -Recurse

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if (-not ($zip.Entries | Where-Object { $_.FullName -eq "manifest.json" })) {
    throw "Generated ZIP does not contain manifest.json at its root."
  }
} finally {
  $zip.Dispose()
}

Write-Host "Created Chrome Web Store beta package:"
Write-Host $zipPath
