#!/usr/bin/env bash
# Codex's built-in image_gen.
#
# Honours --out even though image_gen does not: this build writes call_*.png
# while the wrapper's own --out only recognises ig_*, so it reports "No new
# generated image found" and copies nothing. We parse the path it prints and
# copy the file ourselves. Every Codex-specific fact lives in this file.
#
# Set IMAGE_GEN if the wrapper is not on your PATH.
set -euo pipefail

out=""; prompt=""; model=""; refs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --prompt-file) prompt=$2; shift 2 ;;
    --out)         out=$2;    shift 2 ;;
    --ref)         refs+=(--image "$2"); shift 2 ;;
    --model)       model=$2;  shift 2 ;;
    --aspect)      shift 2 ;;          # image_gen takes no size parameter
    *)             shift ;;
  esac
done
[ -n "$prompt" ] && [ -n "$out" ] || { echo "codex adapter: --prompt-file and --out are required" >&2; exit 2; }

: "${IMAGE_GEN:=image_gen}"
if [ -z "$model" ]; then
  model=$(sed -n 's/^model[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
           "${CODEX_HOME:-$HOME/.codex}/config.toml" 2>/dev/null | head -1)
fi

log=$(mktemp); trap 'rm -f "$log"' EXIT
# ${refs[@]+...} because macOS still ships bash 3.2, where an empty array is
# an unbound variable under `set -u`.
# The exit code is deliberately ignored: image_gen reports "No new generated
# image found" and exits non-zero even when the image was painted, because it
# looks for ig_* while this build writes exec-*. The path it printed is the
# real answer, so we look for that first and only fail if it is not there.
"$IMAGE_GEN" --prompt-file "$prompt" ${model:+--model "$model"} ${refs[@]+"${refs[@]}"} -C "$PWD" >"$log" 2>&1 || true

# Codex prints the path wrapped in markdown backticks, so anchor at the
# leading slash and stop at any quote; the last match is this run's.
src=$(grep -oE "/[^[:space:]\`'\"]*/generated_images/[^[:space:]\`'\"]+\.(png|webp|jpe?g)" "$log" | tail -1)
if [ -z "$src" ] || [ ! -f "$src" ]; then
  echo "codex adapter: no generated image in the output" >&2
  tail -c 2000 "$log" >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"
cp "$src" "$out"
