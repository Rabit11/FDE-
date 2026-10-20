#!/bin/bash
set -e
APP=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform
UNIT=fde-platform.service

echo "=== before ==="
ss -tlnp 2>/dev/null | grep 8084 || true
systemctl --user --no-pager status "$UNIT" | head -15 || true

echo "=== stop service and free 8084 ==="
systemctl --user stop "$UNIT" 2>/dev/null || true
fuser -k 8084/tcp 2>/dev/null || true
pkill -f "${APP}/server/index.js" 2>/dev/null || true
# also kill any node listening on 8084
PIDS=$(ss -tlnp 2>/dev/null | awk '/:8084/ {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)
for p in $PIDS; do
  echo "kill pid $p"
  kill -9 "$p" 2>/dev/null || true
done
sleep 2
ss -tlnp 2>/dev/null | grep 8084 && echo STILL_BUSY || echo "8084 free"

echo "=== ensure PORT=8084 ==="
cd "$APP"
sed -i '/^PORT=/d' .env 2>/dev/null || true
echo 'PORT=8084' >> .env
grep '^PORT=' .env | tail -1

echo "=== restart ==="
systemctl --user daemon-reload
systemctl --user restart "$UNIT"
sleep 5
systemctl --user --no-pager --full status "$UNIT" | head -25 || true
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8084/login.html || echo 000)
echo "HTTP $CODE"
test -f data/platform.json && echo "DB $(wc -c < data/platform.json) bytes"
tail -15 fde.log 2>/dev/null || true
[ "$CODE" = "200" ]
