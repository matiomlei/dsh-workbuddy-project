# Requires Windows PowerShell 5.1 or PowerShell 7, Node.js >=22.15, and an installed DSH Node.js package.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Profile = 'web',
    [string]$DshRoot = '',
    [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' })
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Run this installer on Windows.' }
if ($Profile -eq 'desktop') { throw 'This installer supports DSH CLI profiles. Desktop requires its bundled runtime.' }
foreach ($command in @('node', 'git', 'tar')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command was not found on PATH." }
}
$NodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or $NodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node.js >=22.15 is required.' }
$Archive = (Resolve-Path -LiteralPath $Archive).Path
$DshHome = [IO.Path]::GetFullPath($DshHome)
$ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$ChecksumFile = "$Archive.sha256"
if (-not (Test-Path -LiteralPath $ChecksumFile)) { throw "Missing checksum file: $ChecksumFile" }
$ExpectedHash = ((Get-Content -LiteralPath $ChecksumFile -Raw).Trim() -split '\s+')[0]
if ($ExpectedHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid SHA-256 checksum file.' }
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'Archive checksum mismatch.' }

$TempDir = Join-Path ([IO.Path]::GetTempPath()) ('workbuddy-offline-' + [guid]::NewGuid().ToString('N'))
$PluginsDir = Join-Path $ProfileDir 'plugins'
$Target = Join-Path $PluginsDir 'dsh-workbuddy-project'
$Patch = Join-Path $ProfileDir 'cordis.patch.yml'
$BackupDir = Join-Path (Join-Path $ProfileDir 'offline-backups') ('workbuddy-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$HadPatch = $false
$MovedOldPlugin = $false
$InstalledNewPlugin = $false
$WrotePatch = $false
$OriginalDshHome = $env:DSH_HOME
New-Item -ItemType Directory -Path $TempDir | Out-Null
try {
    $Entries = @(& tar -tzf $Archive)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read archive.' }
    foreach ($Entry in $Entries) {
        if ($Entry -match '(^[/\\])|(^[a-zA-Z]:)|((^|[/\\])\.\.([/\\]|$))') { throw 'Unsafe path in archive.' }
    }
    & tar -xzf $Archive -C $TempDir
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract archive.' }
    $Payload = Join-Path $TempDir 'dsh-workbuddy-project'
    $Helper = Join-Path $TempDir 'offline-helper.mjs'
    foreach ($Required in @($Helper, (Join-Path $Payload 'package.json'), (Join-Path $Payload 'lib/index.js'), (Join-Path $Payload 'node_modules/yaml/package.json'))) {
        if (-not (Test-Path -LiteralPath $Required)) { throw "Incomplete offline archive: $Required" }
    }
    # Resolve the exact local DSH installation; never invoke npx or a package download.
    if ($DshRoot) {
        $Locations = @((Resolve-Path -LiteralPath $DshRoot).Path)
    } else {
        $Locations = @((Get-Location).Path, $PSScriptRoot)
        $DshOnPath = Get-Command dsh -CommandType Application,ExternalScript -ErrorAction SilentlyContinue
        if ($DshOnPath) { $Locations += $DshOnPath.Source }
        if ($env:APPDATA) { $Locations += (Join-Path $env:APPDATA 'npm') }
    }
    $RuntimeJson = & node $Helper resolve-runtime @Locations
    if ($LASTEXITCODE -ne 0) { throw 'Cannot locate DSH. Pass -DshRoot with the directory where offline npm ci installed it.' }
    $Runtime = ($RuntimeJson -join "`n") | ConvertFrom-Json
    $env:DSH_HOME = $DshHome
    & node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<15))process.exit(1);require('node:sqlite')"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js >=22.15 with node:sqlite is required.' }
    & node $Helper init-profile $Runtime.anchor $ProfileDir $Profile
    if ($LASTEXITCODE -ne 0) { throw 'Cannot initialize the DSH profile.' }
    $HadPatch = Test-Path -LiteralPath $Patch
    Write-Host "DSH package: $($Runtime.anchor)"
    $NewPatch = Join-Path $TempDir 'cordis.patch.yml'
    & node $Helper configure $Payload $Patch $NewPatch $Profile
    if ($LASTEXITCODE -ne 0) { throw 'Configuration merge failed; existing installation was not changed.' }
    New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
    if ($HadPatch) { Copy-Item -LiteralPath $Patch -Destination (Join-Path $BackupDir 'cordis.patch.yml') }
    if (Test-Path -LiteralPath $Target) {
        Move-Item -LiteralPath $Target -Destination (Join-Path $BackupDir 'dsh-workbuddy-project')
        $MovedOldPlugin = $true
    }
    Move-Item -LiteralPath $Payload -Destination $Target
    $InstalledNewPlugin = $true
    $WrotePatch = $true
    Copy-Item -LiteralPath $NewPatch -Destination $Patch -Force
    & node $Helper verify-host $Target $ProfileDir $Runtime.anchor
    if ($LASTEXITCODE -ne 0) { throw 'DSH host dependency/module check failed.' }
    & node $Runtime.entry --profile $Profile --dump-config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'DSH configuration check failed.' }
    Write-Host "Installed: $Target"
    Write-Host "Configuration: $Patch"
    Write-Host "Backup: $BackupDir"
    Write-Host "Restart DSH, then open the Project Delivery panel in the sidebar."
} catch {
    $Failure = $_
    if ($WrotePatch) {
        if ($HadPatch) { Copy-Item -LiteralPath (Join-Path $BackupDir 'cordis.patch.yml') -Destination $Patch -Force }
        else { Remove-Item -LiteralPath $Patch -Force }
    }
    if ($InstalledNewPlugin) { & node -e "require('node:fs').rmSync(process.argv[1],{recursive:true,force:true})" $Target }
    if ($MovedOldPlugin) { Move-Item -LiteralPath (Join-Path $BackupDir 'dsh-workbuddy-project') -Destination $Target }
    throw $Failure
} finally {
    $env:DSH_HOME = $OriginalDshHome
    Remove-Item -LiteralPath $TempDir -Recurse -Force
}
