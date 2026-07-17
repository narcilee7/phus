#!/bin/bash
# curl -fsSL https://phus.dev/install.sh | bash
set -e

PHUS_VERSION="${PHUS_VERSION:-main}"
PHUS_HOME="${PHUS_HOME:-$HOME/.phus}"
REPO_URL="${PHUS_REPO:-https://github.com/phus/phus.git}"

OS="unknown"
case "$(uname -s)" in
  Linux*)     OS="linux";;
  Darwin*)    OS="macos";;
  CYGWIN*|MINGW*|MSYS*) OS="windows";;
esac

if [[ "$OS" == "linux" ]] && grep -qi microsoft /proc/version 2>/dev/null; then
  OS="wsl"
fi

log() { echo "[phus-install] $*"; }
warn() { echo "[phus-install] WARNING: $*" >&2; }

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
    local arch
    arch="$(uname -m)"
    local node_tar="node-v20.18.0-${OS}-${arch}.tar.xz"
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

install_phus() {
  local install_dir="$1"
  if [ -d "$install_dir/.git" ]; then
    log "Existing repo at $install_dir; pulling $PHUS_VERSION..."
    git -C "$install_dir" fetch origin
    git -C "$install_dir" checkout "$PHUS_VERSION"
    git -C "$install_dir" pull origin "$PHUS_VERSION" || true
  else
    log "Cloning Phus into $install_dir..."
    rm -rf "$install_dir"
    git clone --depth 1 --branch "$PHUS_VERSION" "$REPO_URL" "$install_dir"
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

  ensure_node
  ensure_pnpm

  local install_dir
  install_dir="$PHUS_HOME/repo"
  install_phus "$install_dir"

  log "Creating Phus home directories..."
  mkdir -p "$PHUS_HOME/skills" "$PHUS_HOME/plugins" "$PHUS_HOME/logs"

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
