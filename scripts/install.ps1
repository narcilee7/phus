#Requires -Version 5.1
# Install Phus from GitHub Releases or source.
# Usage:
#   Invoke-WebRequest -Uri https://phus.dev/install.ps1 | Invoke-Expression
#   $env:PHUS_VERSION="0.2.0"; Invoke-WebRequest -Uri https://phus.dev/install.ps1 | Invoke-Expression
#   $env:PHUS_SOURCE="1"; Invoke-WebRequest -Uri https://phus.dev/install.ps1 | Invoke-Expression

$ErrorActionPreference = "Stop"

$PhusVersion = $env:PHUS_VERSION, "latest" | Select-Object -First 1
$PhusHome = $env:PHUS_HOME, (Join-Path $env:LOCALAPPDATA "phus") | Select-Object -First 1
$PhusSource = $env:PHUS_SOURCE, "0" | Select-Object -First 1
$RepoUrl = $env:PHUS_REPO, "https://github.com/phus/phus.git" | Select-Object -First 1
$GitHubRepo = $env:PHUS_GITHUB_REPO, "phus/phus" | Select-Object -First 1

function Log { param([string]$Message) Write-Host "[phus-install] $Message" }
function Warn { param([string]$Message) Write-Warning "[phus-install] $Message" }

function Resolve-Version {
  param([string]$Version)
  if ($Version -eq "latest") {
    $url = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    try {
      $release = Invoke-RestMethod -Uri $url -UseBasicParsing
      return $release.tag_name -replace '^v',''
    } catch {
      Warn "Could not resolve latest release"
      return $null
    }
  }
  return $Version
}

function Install-FromRelease {
  param([string]$Version)
  $resolved = Resolve-Version $Version
  if (-not $resolved) { return $false }

  $tag = "v$resolved"
  $asset = "phus-$resolved.tar.gz"
  $url = "https://github.com/$GitHubRepo/releases/download/$tag/$asset"
  $tarball = Join-Path $PhusHome "phus.tar.gz"

  Log "Downloading Phus $tag from GitHub Releases..."
  New-Item -ItemType Directory -Force -Path $PhusHome | Out-Null
  Invoke-WebRequest -Uri $url -OutFile $tarball -UseBasicParsing

  Log "Extracting..."
  # After Stage-2 the tarball carries apps/cli/dist/, packages/runtime/dist/
  # etc. under the top-level dir. Stage into a temp dir, then hoist only the
  # cli bin artifacts into $PhusHome/dist/ so the `$PHUS_HOME\dist\phus.mjs`
  # invariant downstream (Dockerfile, install.ps1, systemd unit) holds.
  Remove-Item -Recurse -Force (Join-Path $PhusHome "staging") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $PhusHome "dist") -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $PhusHome "package.json") -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $PhusHome "pnpm-lock.yaml") -ErrorAction SilentlyContinue

  New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "staging") | Out-Null
  tar -xzf $tarball -C (Join-Path $PhusHome "staging") --strip-components=1
  Remove-Item $tarball -ErrorAction SilentlyContinue

  $stagedDist = Join-Path $PhusHome (Join-Path "staging" (Join-Path "apps" (Join-Path "cli" "dist")))
  if (Test-Path $stagedDist) {
    Move-Item -Force $stagedDist (Join-Path $PhusHome "dist")
  } else {
    Warn "Tarball did not contain apps/cli/dist; install layout changed?"
  }

  $stagedPkg = Join-Path $PhusHome (Join-Path "staging" (Join-Path "apps" (Join-Path "cli" "package.json")))
  if (Test-Path $stagedPkg) {
    Move-Item -Force $stagedPkg (Join-Path $PhusHome "package.json")
  }
  $stagedLock = Join-Path $PhusHome (Join-Path "staging" (Join-Path "apps" (Join-Path "cli" "pnpm-lock.yaml")))
  if (Test-Path $stagedLock) {
    Move-Item -Force $stagedLock (Join-Path $PhusHome "pnpm-lock.yaml")
  }
  Remove-Item -Recurse -Force (Join-Path $PhusHome "staging") -ErrorAction SilentlyContinue

  if (Test-Path (Join-Path $PhusHome "package.json")) {
    Ensure-Node
    Ensure-pnpm
    Log "Installing native dependencies..."
    Push-Location $PhusHome
    try { pnpm install --frozen-lockfile --prod } finally { Pop-Location }
  }

  Log "Phus $tag installed at $PhusHome"
  return $true
}

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
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-$arch.msi" -OutFile $installer -UseBasicParsing
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

function Install-FromSource {
  param([string]$InstallDir)
  Ensure-Node
  Ensure-pnpm

  if (Test-Path (Join-Path $InstallDir ".git")) {
    Log "Existing repo at $InstallDir; pulling..."
    git -C $InstallDir fetch origin
    git -C $InstallDir checkout main
    git -C $InstallDir pull origin main
  } else {
    Log "Cloning Phus into $InstallDir..."
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    git clone --depth 1 $RepoUrl $InstallDir
  }

  Log "Installing dependencies..."
  Push-Location $InstallDir
  try { pnpm install } finally { Pop-Location }

  Log "Building..."
  Push-Location $InstallDir
  try { pnpm build } finally { Pop-Location }

  # Link dist to PHUS_HOME for consistency with release install. After
  # the Stage-2 split the workspace build emits apps/cli/dist, not a
  # top-level dist/.
  $distLink = Join-Path $PhusHome "dist"
  $pkgLink = Join-Path $PhusHome "package.json"
  if (Test-Path $distLink) { Remove-Item $distLink -Force }
  if (Test-Path $pkgLink) { Remove-Item $pkgLink -Force }
  New-Item -ItemType SymbolicLink -Path $distLink -Target (Join-Path (Join-Path $InstallDir "apps") "dist") | Out-Null
  New-Item -ItemType SymbolicLink -Path $pkgLink -Target (Join-Path (Join-Path $InstallDir "apps") "package.json") | Out-Null

  Log "Phus (source) installed at $InstallDir"
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
Log "Requested version: $PhusVersion"

New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "skills") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "plugins") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PhusHome "logs") | Out-Null

if ($PhusSource -eq "1") {
  Install-FromSource -InstallDir (Join-Path $PhusHome "repo")
} else {
  $ok = Install-FromRelease -Version $PhusVersion
  if (-not $ok) {
    Log "Falling back to source install..."
    Install-FromSource -InstallDir (Join-Path $PhusHome "repo")
  }
}

$BinDir = Join-Path $PhusHome "dist"
Add-ToPath -Dir $BinDir

Log "Phus installed at $PhusHome"
Log "Run `phus setup` to configure your first provider and channel."
