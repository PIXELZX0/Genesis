#!/bin/bash
set -euo pipefail

# Installs Chromium + Tor + Genesis in one go.
# Usage: curl -fsSL --proto '=https' --tlsv1.2 https://genesis.pixelzx.com/install-genesis-tor-browser.sh | bash

GENESIS_INSTALL_URL="${GENESIS_INSTALL_URL:-https://genesis.pixelzx.com/install.sh}"

info() { printf '==> %s\n' "$1"; }
err() { printf 'error: %s\n' "$1" >&2; }

install_linux() {
    if command -v apt-get &>/dev/null; then
        sudo apt-get update
        sudo apt-get install -y chromium tor
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y chromium tor
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm chromium tor
    else
        err "no supported package manager found (apt-get, dnf, pacman); install chromium and tor manually"
        exit 1
    fi
}

install_macos() {
    if ! command -v brew &>/dev/null; then
        err "Homebrew required on macOS: https://brew.sh"
        exit 1
    fi
    brew install --cask chromium
    brew install tor
}

# genesis's own install.sh (piped below) also checks/installs Node, but do it
# here too so this script works standalone if that delegation ever changes.
ensure_node() {
    if command -v node &>/dev/null; then
        return 0
    fi
    info "Node.js not found, installing it"
    case "$(uname -s)" in
        Linux)
            if command -v apt-get &>/dev/null; then
                sudo apt-get install -y nodejs npm
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y nodejs npm
            elif command -v pacman &>/dev/null; then
                sudo pacman -Sy --noconfirm nodejs npm
            else
                err "no supported package manager found (apt-get, dnf, pacman); install Node.js manually: https://nodejs.org"
                exit 1
            fi
            ;;
        Darwin)
            brew install node
            ;;
    esac
}

case "$(uname -s)" in
    Linux) info "Installing Chromium + Tor (Linux)"; install_linux ;;
    Darwin) info "Installing Chromium + Tor (macOS)"; install_macos ;;
    *) err "unsupported OS: $(uname -s)"; exit 1 ;;
esac

ensure_node

info "Installing Genesis"
curl -fsSL --proto '=https' --tlsv1.2 "$GENESIS_INSTALL_URL" | bash

info "Done. Start Tor with 'tor' (or your OS service manager), then run 'genesis'."
