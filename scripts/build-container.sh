#!/bin/sh
set -eu

output=--load
case "${1:-}" in
    --push)
        output=--push
        shift
        ;;
    -h|--help)
        printf '%s\n' "Usage: $0 [--push] [image-tag]"
        exit 0
        ;;
esac

image_tag=${1:-kamikoto/kanjikinjo:latest}
if [ "$#" -gt 1 ] || [ "${image_tag#-}" != "$image_tag" ]; then
    printf '%s\n' "Usage: $0 [--push] [image-tag]" >&2
    exit 2
fi

cd "$(dirname "$0")/.."

if [ ! -s data/dictionary/manifest.json ]; then
    printf '%s\n' 'Generate the dictionary before building. See the Dictionary section in README.md.' >&2
    exit 1
fi

exec docker buildx build --platform linux/amd64 --tag "$image_tag" "$output" .
