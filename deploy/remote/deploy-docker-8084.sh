#!/bin/bash
# Remote: stop old process, deploy FDE platform with Docker on port 8084
set -e
APP_DIR=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform
TARBALL=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-deploy.tgz
UNIT=fde-platform.service
CONTAINER=fde-platform

echo "[1/7] Stop old process and free port 8084..."
systemctl --user stop "$UNIT" 2>/dev/null || true
systemctl --user disable "$UNIT" 2>/dev/null || true
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
docker stop keyan-nginx 2>/dev/null || true
docker update --restart=no keyan-nginx 2>/dev/null || true
fuser -k 8084/tcp 2>/dev/null || true
pkill -f "${APP_DIR}/server/index.js" 2>/dev/null || true
sleep 2

echo "[2/7] Extract app code..."
mkdir -p "$APP_DIR/data/uploads"
cd "$APP_DIR"
tar -xzf "$TARBALL"
if [ ! -f .env ]; then
  cp .env.example .env
fi
sed -i '/^PORT=/d' .env
echo 'PORT=8084' >> .env

echo "[3/7] Check Docker..."
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not installed"
  exit 1
fi

echo "[4/7] Build image from local base (no pull)..."
docker build --pull=false -t fde-platform:latest .

echo "[5/7] Start container..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p 8084:8084 \
  -e PORT=8084 \
  -e NODE_ENV=production \
  --env-file .env \
  -v "$APP_DIR/data:/app/data" \
  fde-platform:latest

echo "[6/7] Health check..."
sleep 5
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8084/login.html || echo 000)
echo "HTTP $CODE"
docker ps --filter "name=$CONTAINER" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
ss -tlnp 2>/dev/null | grep 8084 || true
docker logs --tail 30 "$CONTAINER" 2>/dev/null || true

echo "[7/7] Done"
[ "$CODE" = "200" ] || exit 1
echo ""
echo "Docker deploy OK: http://10.90.111.114:8084"
echo "  status: docker ps | grep $CONTAINER"
echo "  logs:   docker logs -f $CONTAINER"
echo "  stop:   docker stop $CONTAINER"
