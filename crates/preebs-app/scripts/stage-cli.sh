#!/usr/bin/env bash
# Copy the release `preebs` binary to the Tauri sidecar path.
# Usage: stage-cli.sh [target-triple] [path-to-binary]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  TARGET="$(rustc -vV | sed -n 's/^host: //p')"
fi
SRC="${2:-}"
if [[ -z "$SRC" ]]; then
  if [[ -x "$ROOT/target/$TARGET/release/preebs" ]]; then
    SRC="$ROOT/target/$TARGET/release/preebs"
  else
    SRC="$ROOT/target/release/preebs"
  fi
fi
if [[ ! -f "$SRC" ]]; then
  echo "CLI binary not found: $SRC" >&2
  exit 1
fi
DEST="$ROOT/crates/preebs-app/src-tauri/binaries"
mkdir -p "$DEST"
cp "$SRC" "$DEST/preebs-cli-$TARGET"
chmod +x "$DEST/preebs-cli-$TARGET"
echo "staged $DEST/preebs-cli-$TARGET"
