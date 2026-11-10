#!/usr/bin/env bash
# Materialises the pinned LibreOffice source in upstream/core (git-ignored, read-only reference).
# Usage: tools/upstream/fetch.sh [commit]   (defaults to the commit in upstream.json)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
repo="$(node -p "require('$root/upstream.json').repository")"
commit="${1:-$(node -p "require('$root/upstream.json').commit")}"
dir="$root/upstream/core"
if [ ! -d "$dir/.git" ]; then
  mkdir -p "$root/upstream"
  git init -q "$dir"
  git -C "$dir" remote add origin "$repo"
fi
git -C "$dir" fetch -q --depth 1 origin "$commit"
git -C "$dir" checkout -q FETCH_HEAD
echo "upstream/core at $(git -C "$dir" rev-parse HEAD)"
