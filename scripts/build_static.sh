#!/usr/bin/env bash
# Build the web page for a static host (Hugging Face static Space, GitHub Pages, Cloudflare Pages, any web server):
# the Angular app, the Explore data (labels + frozen predictions of the three models, 346 proteins) and config.json.
#
#   bash scripts/build_static.sh                       -> dist/static-site/, Predict not connected ("apiBaseUrl": null)
#   bash scripts/build_static.sh --api https://ai.x    -> Predict calls that AI server (it needs BINDSITE_CORS_ORIGINS
#                                                         set to this site's origin)
#
# Upload the *contents* of dist/static-site/. Routes are after "#" (/#/explore?...), so reloads and shared links work
# on any static host, at its root or in a sub-folder. Changing the AI server later = editing config.json only.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/dist/static-site"
API=null
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="\"${2%/}\""; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO"
mkdir -p dist
echo "building the web page (npx ng build) ..."
npx ng build > "$REPO/dist/static-site.build.log" 2>&1 || { tail -30 "$REPO/dist/static-site.build.log"; exit 1; }
rm -rf "$OUT"
cp -r dist/bindsite-explorer/browser "$OUT"
printf '{\n  "apiBaseUrl": %s\n}\n' "$API" > "$OUT/config.json"
cp deploy/static/README.md "$OUT/README.md"
# Hugging Face refuses binary files pushed with plain git: these go through Git LFS / Xet (web upload and `hf upload`
# handle that on their own).
printf '%s\n' '*.gz filter=lfs diff=lfs merge=lfs -text' '*.ico filter=lfs diff=lfs merge=lfs -text' > "$OUT/.gitattributes"

# Checks: what a static host needs, and nothing that needs a server.
fail() { echo "!! $*" >&2; exit 1; }
grep -q '<base href="./">' "$OUT/index.html" || fail "index.html must have <base href=\"./\">"
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$OUT/config.json" || fail "config.json is not valid JSON"
[ -f "$OUT/explore-data/index.json" ] || fail "explore-data/index.json missing"
n_docs=$(find "$OUT/explore-data/proteins" -name '*.json' | wc -l)
n_pdb=$(find "$OUT/explore-data/structures" -name '*.pdb.gz' | wc -l)
expected=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['proteins']))" "$OUT/explore-data/index.json")
[ "$n_docs" = "$expected" ] && [ "$n_pdb" = "$expected" ] || fail "explore-data: $n_docs docs, $n_pdb structures, $expected proteins in the index"
echo "dist/static-site: $(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l) files, $expected proteins, apiBaseUrl $API"
