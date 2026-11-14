#!/usr/bin/env bash
# Materialises the pinned upstream sources (git-ignored, read-only references):
# LibreOffice in upstream/core, LanguageTool and its ported libraries in upstream/languagetool/<id>
# (sparse, blobs on demand, as src/languagetool/upstream.json lists them).
# Usage: tools/upstream/fetch.sh [commit]   (the commit overrides LibreOffice's in upstream.json)
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

lt="$root/src/languagetool/upstream.json"
for id in $(node -p "Object.keys(require('$lt')).filter((k) => !k.startsWith('\$')).join(' ')"); do
  repo="$(node -p "require('$lt')['$id'].repository")"
  commit="$(node -p "require('$lt')['$id'].commit")"
  dir="$root/upstream/languagetool/$id"
  if [ ! -d "$dir/.git" ]; then
    mkdir -p "$dir"
    git init -q "$dir"
    git -C "$dir" remote add origin "$repo"
  fi
  git -C "$dir" sparse-checkout set --no-cone $(node -p "(require('$lt')['$id'].sparse ?? ['/*']).join(' ')")
  git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$commit"
  git -C "$dir" checkout -q FETCH_HEAD
  echo "upstream/languagetool/$id at $(git -C "$dir" rev-parse HEAD)"
done
