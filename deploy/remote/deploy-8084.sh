#!/bin/bash
# 在远程服务器执行：释放 8084、部署代码，并以 systemd --user 守护运行
# 关机/退出 SSH 后服务仍持续在后台运行；进程崩溃会自动重启
set -e
APP_DIR=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform
TARBALL=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-deploy.tgz
UNIT=fde-platform.service

echo "[1/6] 释放 8084 端口..."
docker stop keyan-nginx 2>/dev/null || true
docker update --restart=no keyan-nginx 2>/dev/null || true
systemctl --user stop "$UNIT" 2>/dev/null || true
fuser -k 8084/tcp 2>/dev/null || true
pkill -f "${APP_DIR}/server/index.js" 2>/dev/null || true
sleep 2

echo "[2/6] 解压应用代码..."
mkdir -p "$APP_DIR/data"
cd "$APP_DIR"
tar -xzf "$TARBALL"
sed -i '/^PORT=/d' .env 2>/dev/null || true
if [ ! -f .env ]; then cp .env.example .env; fi
echo 'PORT=8084' >> .env
npm install --omit=dev --silent

echo "[3/6] 写入管理脚本与 systemd 单元..."
mkdir -p deploy/remote
if [ -f /data_SSD_21T/users/yanghuiran/yanghuiran/deploy-remote-start.sh ]; then
  cp -f /data_SSD_21T/users/yanghuiran/yanghuiran/deploy-remote-start.sh "$APP_DIR/start.sh"
fi
if [ -f /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.service ]; then
  cp -f /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.service "$APP_DIR/deploy/remote/fde-platform.service"
fi
chmod +x "$APP_DIR/start.sh"

echo "[4/6] 安装并启用用户级守护服务（退出登录仍常驻）..."
mkdir -p "$HOME/.config/systemd/user"
cp -f "$APP_DIR/deploy/remote/fde-platform.service" "$HOME/.config/systemd/user/$UNIT"
loginctl enable-linger "$(whoami)" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable "$UNIT"

echo "[5/6] 启动服务..."
: >> fde.log
systemctl --user restart "$UNIT"
sleep 4

echo "[6/6] 健康检查..."
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8084/login.html || echo 000)
echo "HTTP $CODE"
systemctl --user --no-pager --full status "$UNIT" | head -20 || true
ss -tlnp 2>/dev/null | grep 8084 || true
tail -8 fde.log 2>/dev/null || true
[ "$CODE" = "200" ] || exit 1
echo ""
echo "部署完成（后台常驻）: http://10.90.111.114:8084"
echo "  状态: systemctl --user status $UNIT"
echo "  停止: systemctl --user stop $UNIT"
echo "  日志: journalctl --user -u $UNIT -f"
echo "  或:   bash $APP_DIR/start.sh status"
