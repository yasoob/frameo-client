#!/bin/sh
set -eu
mkdir -p dist
set --
for target in darwin/arm64 darwin/amd64 linux/arm64 linux/amd64 windows/arm64 windows/amd64
do
  os=${target%/*}
  arch=${target#*/}
  extension=""
  if [ "$os" = windows ]; then extension=".exe"; fi
  echo "Building $os/$arch"
  binary="dist/frameo-local-$os-$arch$extension"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags="-s -w" -o "$binary" ./cmd/frameo
  set -- "$@" "$binary"
done
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$@" > dist/SHA256SUMS
else
  shasum -a 256 "$@" > dist/SHA256SUMS
fi
