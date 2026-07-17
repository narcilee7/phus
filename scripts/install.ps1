#Requires -Version 5.1
# Invoke-WebRequest -Uri https://phus.dev/install.ps1 | Invoke-Expression
$ErrorActionPreference = "Stop"

$PhusVersion = $env:PHUS_VERSION, "main" | Select-Object -First 1
$PhusHome = $env:PHUS_HOME, (Join-Path $env:LOCALAPPDATA "phus") | Select-Object -First 1
$RepoUrl = $env:PHUS_REPO, "https://github.com/phus/phus.git" | Select-Object -First 1

function Log { param([string]$Message) Write-Host "[phus-install] $Message" }
function Warn { param([string]$Message) Write-Warning "[phus-install] $Message" }

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $version = (node -v) -replace '^v',''
    $major = [int]($version -split '\.')[0]
    if ($major -ge 20) {
      Log "Node $version found"
      return
    }
    Warn "Node $version is too old (need >= 20)"
  }

  Log "Installing Node.js 20+..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id OpenJS.NodeJS.LTS --version 20.18.0 --accept-source-agreements --accept-package-agreements
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install nodejs-lts --version=20.18.0 -y
  } else {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $installer = "$env:TEMP\node-v20.18.0-$arch.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-$arch.msi" -OutFile $installer
    Start-Process msiexec.exe -ArgumentList "/i","`"$installer`"","/quiet","/norestart" -Wait
    Remove-Item $installer -ErrorAction SilentlyContinue
  }

  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js installation failed"
  }
  Log "Node $(node -v) installed"
}

function Ensure-pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Log "pnpm $(pnpm -v) found"
    return
  }
  Log "Installing pnpm..."
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable
    corepack prepare pnpm@latest --activate
  } else {
    npm install -g pnpm
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm installation failed"
  }
}

function Install-Phus {
  param([string]$InstallDir)
  if (Test-Path (Join-Path $InstallDir ".git")) {
    Log "Existing repo at $InstallDir; pulling $PhusVersion..."
    git -C $InstallDir fetch origin
    git -C $InstallDir checkout $PhusVersion
    git -C $InstallDir pull origin $PhusVersion
  } else {
    Log "Cloning Phus into $InstallDir..."
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    git clone --depth 1 --branch $PhusVersion $RepoUrl $InstallDir
  }

  Log "Installing dependencies..."
  Push-Location $InstallDir
  try { pnpm install } finally { Pop-Location }

  Log "Building..."
  Push-Location $InstallDir
  try { pnpm build } finally { Pop-Location }
}

function Add-ToPath {
  param([string]$Dir)
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$Dir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$Dir", "User")
    Log "Added $Dir to user PATH"
  }
  $env:Path += ";$Dir"
}

Log "PHUS_HOME=$PhusHome"
Ensure-Node
Ensure-pnpm

$InstallDir = Join-Path $PhusHome "repo"
Install-Phus -InstallDir $InstallDir

Log "Creating Phus home directories..."
New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "skills") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "plugins") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "logs") | Out-Null

$BinDir = Join-Path $PhusHome "dist"
Add-ToPath -Dir $BinDir

Log "Phus installed at $PhusHome"
Log "Run `phus setup` to configure your first provider and channel."
