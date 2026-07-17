#!/bin/bash
# Install Phus from GitHub Releases or source.
# Usage:
#   curl -fsSL https://phus.dev/install.sh | bash
#   PHUS_VERSION=0.2.0 curl -fsSL https://phus.dev/install.sh | bash
#   PHUS_SOURCE=1 curl -fsSL https://phus.dev/install.sh | bash

set -e

PHUS_VERSION="${PHUS_VERSION:-latest}"
PHUS_HOME="${PHUS_HOME:-$HOME/.phus}"
PHUS_SOURCE="${PHUS_SOURCE:-0}"
REPO_URL="${PHUS_REPO:-https://github.com/phus/phus.git}"
GITHUB_REPO="${PHUS_GITHUB_REPO:-phus/phus}"

OS="unknown"
ARCH="$(uname -m)"
case "$(uname -s)" in
  Linux*)     OS="linux";;
  Darwin*)    OS="macos";;
  CYGWIN*|MINGW*|MSYS*) OS="windows";;
esac

if [[ "$OS" == "linux" ]] && grep -qi microsoft /proc/version 2>/dev/null; then
  OS="linux"
fi

log() { echo "[phus-install] $*"; }
warn() { echo "[phus-install] WARNING: $*" >&2; }

# Resolve "latest" to an actual version via GitHub Releases API.
resolve_version() {
  local version="$1"
  if [ "$version" = "latest" ]; then
    local url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
    local resolved
    resolved=$(curl -fsSL "$url" | grep -o '"tag_name": *"v[^"]*"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')
    if [ -z "$resolved" ]; then
      warn "Could not resolve latest release; falling back to source install"
      echo ""
      return 1
    fi
    echo "$resolved"
  else
    echo "$version"
  fi
}

# Download pre-built release tarball from GitHub Releases.
install_from_release() {
  local version="$1"
  local resolved
  resolved=$(resolve_version "$version") || return 1

  local tag="v${resolved}"
  local asset="phus-${resolved}.tar.gz"
  local url="https://github.com/${GITHUB_REPO}/releases/download/${tag}/${asset}"
  local install_dir="$PHUS_HOME"

  log "Downloading Phus $tag from GitHub Releases..."
  mkdir -p "$install_dir"
  curl -fsSL "$url" -o "$install_dir/phus.tar.gz"

  log "Extracting..."
  rm -rf "$install_dir/dist" "$install_dir/package.json" "$install_dir/pnpm-lock.yaml"
  tar -xzf "$install_dir/phus.tar.gz" -C "$install_dir" --strip-components=1
  rm -f "$install_dir/phus.tar.gz"

  # Rebuild native deps if needed (better-sqlite3).
  if [ -f "$install_dir/package.json" ]; then
    ensure_node
    ensure_pnpm
    log "Installing native dependencies..."
    (
      cd "$install_dir"
      pnpm install --frozen-lockfile --prod
    )
  fi

  log "Phus $tag installed at $install_dir"
  return 0
}

# Fallback: clone from source and build.
install_from_source() {
  local install_dir="$PHUS_HOME/repo"

  ensure_node
  ensure_pnpm

  if [ -d "$install_dir/.git" ]; then
    log "Existing repo at $install_dir; pulling..."
    git -C "$install_dir" fetch origin
    git -C "$install_dir" checkout main
    git -C "$install_dir" pull origin main || true
  else
    log "Cloning Phus into $install_dir..."
    rm -rf "$install_dir"
    git clone --depth 1 "$REPO_URL" "$install_dir"
  fi

  log "Installing dependencies..."
  (
    cd "$install_dir"
    pnpm install
  )

  log "Building..."
  (
    cd "$install_dir"
    pnpm build
  )

  # Link dist to PHUS_HOME for consistency with release install.
  ln -sfn "$install_dir/dist" "$PHUS_HOME/dist"
  ln -sfn "$install_dir/package.json" "$PHUS_HOME/package.json"

  log "Phus (source) installed at $install_dir"
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local version
    version="$(node -v | sed 's/^v//')"
    local major
    major="$(echo "$version" | cut -d. -f1)"
    if [ "$major" -ge 20 ]; then
      log "Node $version found"
      return 0
    fi
    warn "Node $version is too old (need >= 20)"
  fi

  log "Installing Node.js 20+..."
  if command -v fnm >/dev/null 2>&1; then
    fnm install 20 && fnm use 20 && eval "$(fnm env)"
  elif command -v nvm >/dev/null 2>&1; then
    nvm install 20 && nvm use 20
  elif [ "$OS" == "macos" ] && command -v brew >/dev/null 2>&1; then
    brew install node@20
    if [ -d /opt/homebrew/opt/node@20/bin ]; then
      export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    elif [ -d /usr/local/opt/node@20/bin ]; then
      export PATH="/usr/local/opt/node@20/bin:$PATH"
    fi
  else
    local node_tar="node-v20.18.0-${OS}-${ARCH}.tar.xz"
    local node_url="https://nodejs.org/dist/v20.18.0/${node_tar}"
    local tmpdir
    tmpdir="$(mktemp -d)"
    curl -fsSL "$node_url" -o "${tmpdir}/${node_tar}"
    mkdir -p "$HOME/.local"
    tar -xf "${tmpdir}/${node_tar}" -C "$HOME/.local" --strip-components=1
    rm -rf "$tmpdir"
    export PATH="$HOME/.local/bin:$PATH"
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js installation failed" >&2
    exit 1
  fi
  log "Node $(node -v) installed"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    log "pnpm $(pnpm -v) found"
    return 0
  fi

  log "Installing pnpm..."
  if [ -n "$(command -v corepack)" ]; then
    corepack enable
    corepack prepare pnpm@latest --activate
  else
    npm install -g pnpm
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "ERROR: pnpm installation failed" >&2
    exit 1
  fi
}

symlink_bin() {
  local target="$PHUS_HOME/dist/phus.mjs"
  if [ ! -f "$target" ]; then
    warn "Built binary not found at $target"
    return 1
  fi

  local bin_dir=""
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) bin_dir="$HOME/.local/bin";;
    *":$HOME/bin:"*) bin_dir="$HOME/bin";;
  esac

  if [ -n "$bin_dir" ]; then
    mkdir -p "$bin_dir"
    ln -sf "$target" "$bin_dir/phus"
    log "Symlinked phus to $bin_dir/phus"
    return 0
  fi

  return 1
}

main() {
  log "Detected OS: $OS"
  log "PHUS_HOME=$PHUS_HOME"
  log "Requested version: $PHUS_VERSION"

  mkdir -p "$PHUS_HOME/skills" "$PHUS_HOME/plugins" "$PHUS_HOME/logs"

  if [ "$PHUS_SOURCE" = "1" ]; then
    install_from_source
  else
    if ! install_from_release "$PHUS_VERSION"; then
      log "Falling back to source install..."
      install_from_source
    fi
  fi

  if ! symlink_bin; then
    echo ""
    echo "Add Phus to your PATH manually:"
    echo "  export PATH=\"$PHUS_HOME/dist:\$PATH\""
    echo "Or create a symlink:"
    echo "  ln -s $PHUS_HOME/dist/phus.mjs ~/.local/bin/phus"
  fi

  echo ""
  echo "✓ Phus installed at $PHUS_HOME"
  echo "Run \`phus setup\` to configure your first provider and channel."
}

main "$@"
