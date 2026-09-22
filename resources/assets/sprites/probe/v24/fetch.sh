#!/bin/zsh
# fetch.sh <dir>: download the east rotation of every "name id" line in <dir>/ids.txt,
# polling until each character has finished (up to ~10 min).
cd "$1" || exit 1
B=https://backblaze.pixellab.ai/file/pixellab-characters/bc74b8b7-40e1-46d1-a78d-8fcceceb903c
for try in {1..60}; do
  left=0
  while read -r name id; do
    [[ -z "$name" || -s "$name.png" ]] && continue
    curl -sfL -o "$name.png" "$B/$id/rotations/east.png" || { rm -f "$name.png"; left=$((left+1)); }
  done < ids.txt
  (( left == 0 )) && { echo "all fetched"; exit 0; }
  sleep 10
done
echo "timed out with $left missing"
