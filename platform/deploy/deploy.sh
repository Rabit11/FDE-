#!/bin/bash
# 科研项目信息化管理平台 — 部署到 10.90.111.114
set -euo pipefail

TARGET_HOST="${1:-10.90.111.114}"
TARGET_USER="${2:-root}"
if [ -z "${REMOTE_DIR:-}" ]; then
  if [ "$TARGET_USER" = "root" ]; then
    REMOTE_DIR="/opt/keyan-platform"
  else
    REMOTE_DIR='~/keyan-platform'
  fi
fi

echo "==> 打包平台代码..."
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"
tar czf /tmp/keyan-platform.tar.gz \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.git \
  docker-compose.yml .env.example nginx backend frontend

echo "==> 上传到 ${TARGET_USER}@${TARGET_HOST}:${REMOTE_DIR}"
ssh "${TARGET_USER}@${TARGET_HOST}" "mkdir -p ${REMOTE_DIR}"
scp /tmp/keyan-platform.tar.gz "${TARGET_USER}@${TARGET_HOST}:/tmp/"

echo "==> 远程构建并启动..."
ssh "${TARGET_USER}@${TARGET_HOST}" bash -s <<EOF
set -e
cd ${REMOTE_DIR}
tar xzf /tmp/keyan-platform.tar.gz
if [ ! -f .env ]; then cp .env.example .env; echo "已创建 .env，请修改 DB_PASSWORD 和 JWT_SECRET"; fi
docker compose down 2>/dev/null || true
docker compose build --no-cache
docker compose up -d
docker compose ps
echo ""
echo "部署完成，访问: http://${TARGET_HOST}:8084"
EOF
