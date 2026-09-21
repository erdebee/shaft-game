# fetch.sh <jobs-file> <suffix>: download every job to <name>-<suffix>.png, retrying until all exist
for try in $(seq 1 40); do
  missing=0
  while read n id; do
    f="$n$2.png"
    python3 -c "from PIL import Image;Image.open('$f')" 2>/dev/null && continue
    curl -sfL -o "$f" "https://api.pixellab.ai/mcp/images/$id/download" && python3 -c "from PIL import Image;Image.open('$f')" 2>/dev/null || { rm -f "$f"; missing=1; }
  done < "$1"
  [ $missing = 0 ] && break
  python3 -c "import time;time.sleep(10)"
done
