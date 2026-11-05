#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/ordo-build.XXXXXX")"
trap 'rm -rf "$BUILD"' EXIT
APP="${ORDO_OUTPUT:-$ROOT/../Ordo.app}"
NODE_BIN="${ORDO_NODE:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "请将 ORDO_NODE 指向 Node.js 24 或更高版本的可执行文件。" >&2
  exit 1
fi
"$NODE_BIN" -e 'if(+process.versions.node.split(".")[0] < 24) process.exit(1)'
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/runtime" "$BUILD/AppIcon.iconset"
cp "$ROOT/native/Info.plist" "$APP/Contents/Info.plist"
cp "$NODE_BIN" "$APP/Contents/Resources/runtime/node"
cp "$ROOT/native/NODE-LICENSE" "$APP/Contents/Resources/runtime/LICENSE"
cp "$ROOT/native/smoke.js" "$APP/Contents/Resources/smoke.js"
rsync -a --exclude='.git' --exclude='data' --exclude='dev' --exclude='test' --exclude='deploy' "$ROOT/backend/" "$APP/Contents/Resources/backend/"
xcrun swiftc -swift-version 5 -O -target "$(uname -m)-apple-macosx13.0" -framework AppKit -framework WebKit \
  "$ROOT/native/App.swift" -o "$APP/Contents/MacOS/Ordo"
xcrun swiftc -swift-version 5 -O -framework AppKit "$ROOT/native/Icon.swift" -o "$BUILD/make-icon"
"$BUILD/make-icon" "$BUILD/AppIcon.iconset"
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP/Contents/Resources/runtime/node"
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "已生成：$APP"
