# fetch-edit.sh <jobs>: each line "<job-id> <name0> [<name1> ...]", frame i saved as <name_i>.png
for try in $(seq 1 40); do
  missing=0
  while read id names; do
    i=0
    for n in $names; do
      python3 -c "from PIL import Image;Image.open('$n.png')" 2>/dev/null || {
        curl -sfL -o "$n.png" "https://api.pixellab.ai/mcp/images/$id/download?index=$i" && python3 -c "from PIL import Image;Image.open('$n.png')" 2>/dev/null || { rm -f "$n.png"; missing=1; }
      }
      i=$((i+1))
    done
  done < "$1"
  [ $missing = 0 ] && break
  python3 -c "import time;time.sleep(10)"
done
