#!/bin/bash
# 在远程服务器执行：释放 8084、部署代码，并以 systemd --user 守护运行
# 关机/退出 SSH 后服务仍持续在后台运行；进程崩溃会自动重启
set -e
APP_DIR=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform
TARBALL=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-deploy.tgz
UNIT=fde-platform.service

echo "[1/7] 备份当前版本（含 data 数据库）..."
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.backup.$STAMP
if [ -d "$APP_DIR" ]; then
  cp -a "$APP_DIR" "$BACKUP_DIR"
  echo "BACKUP_OK $BACKUP_DIR"
  du -sh "$BACKUP_DIR" "$BACKUP_DIR/data" 2>/dev/null || true
else
  echo "NO_PREVIOUS_APP"
fi

echo "[2/7] 释放 8084 端口..."
docker stop keyan-nginx 2>/dev/null || true
docker update --restart=no keyan-nginx 2>/dev/null || true
docker stop fde-platform 2>/dev/null || true
docker update --restart=no fde-platform 2>/dev/null || true
docker rm -f fde-platform 2>/dev/null || true
systemctl --user stop "$UNIT" 2>/dev/null || true
fuser -k 8084/tcp 2>/dev/null || true
pkill -f "${APP_DIR}/server/index.js" 2>/dev/null || true
sleep 2

echo "[3/7] 解压应用代码（不覆盖 data/）..."
mkdir -p "$APP_DIR/data"
# 保护数据库：解压前移走 data，解压后再移回
DATA_SAFE=/tmp/fde-data-preserve-$$
if [ -d "$APP_DIR/data" ]; then
  mv "$APP_DIR/data" "$DATA_SAFE"
fi
cd "$APP_DIR"
tar -xzf "$TARBALL"
if [ -d "$DATA_SAFE" ]; then
  rm -rf "$APP_DIR/data"
  mv "$DATA_SAFE" "$APP_DIR/data"
fi
# 确保 .env 存在且 PORT=8084，不重建业务数据
sed -i '/^PORT=/d' .env 2>/dev/null || true
if [ ! -f .env ]; then cp .env.example .env; fi
echo 'PORT=8084' >> .env
npm install --omit=dev --silent

echo "[4/7] 写入管理脚本与 systemd 单元..."
mkdir -p deploy/remote
if [ -f /data_SSD_21T/users/yanghuiran/yanghuiran/deploy-remote-start.sh ]; then
  cp -f /data_SSD_21T/users/yanghuiran/yanghuiran/deploy-remote-start.sh "$APP_DIR/start.sh"
fi
if [ -f /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.service ]; then
  cp -f /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.service "$APP_DIR/deploy/remote/fde-platform.service"
fi
chmod +x "$APP_DIR/start.sh"

echo "[5/7] 安装并启用用户级守护服务（退出登录仍常驻）..."
mkdir -p "$HOME/.config/systemd/user"
cp -f "$APP_DIR/deploy/remote/fde-platform.service" "$HOME/.config/systemd/user/$UNIT"
loginctl enable-linger "$(whoami)" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable "$UNIT"

echo "[6/7] 启动服务..."
: >> fde.log
systemctl --user restart "$UNIT"
sleep 4

echo "[7/7] 健康检查..."
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8084/login.html || echo 000)
echo "HTTP $CODE"
systemctl --user --no-pager --full status "$UNIT" | head -20 || true
ss -tlnp 2>/dev/null | grep 8084 || true
tail -8 fde.log 2>/dev/null || true
if [ -f "$APP_DIR/data/platform.json" ]; then
  echo "DB_PRESENT $(wc -c < "$APP_DIR/data/platform.json") bytes"
else
  echo "DB_WARN missing platform.json"
fi
[ "$CODE" = "200" ] || exit 1
echo ""
echo "部署完成（后台常驻）: http://10.90.111.114:8084"
echo "  备份: $BACKUP_DIR"
echo "  状态: systemctl --user status $UNIT"
echo "  停止: systemctl --user stop $UNIT"
echo "  日志: journalctl --user -u $UNIT -f"
echo "  或:   bash $APP_DIR/start.sh status"
