#!/bin/bash
# FDE 平台守护进程管理（systemd --user；退出 SSH / 关机不影响远端服务）
set -e
APP_DIR=/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform
UNIT=fde-platform.service
UNIT_SRC="$APP_DIR/deploy/remote/fde-platform.service"
UNIT_DST="$HOME/.config/systemd/user/$UNIT"

ensure_service() {
  mkdir -p "$HOME/.config/systemd/user"
  if [ -f "$UNIT_SRC" ]; then
    cp -f "$UNIT_SRC" "$UNIT_DST"
  elif [ -f /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.service ]; then
    cp -f /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform.service "$UNIT_DST"
  else
    echo "找不到 unit 文件: $UNIT_SRC" >&2
    exit 1
  fi
  # 允许用户注销后仍保持 user systemd 常驻
  loginctl enable-linger "$(whoami)" 2>/dev/null || true
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT"
}

cmd="${1:-start}"
cd "$APP_DIR" 2>/dev/null || true

case "$cmd" in
  start|restart|install)
    ensure_service
    # 清理旧 nohup 进程，避免端口冲突
    if [ -f "$APP_DIR/fde.pid" ]; then
      old=$(cat "$APP_DIR/fde.pid" 2>/dev/null || true)
      if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
        kill "$old" 2>/dev/null || true
        sleep 1
      fi
      rm -f "$APP_DIR/fde.pid"
    fi
    fuser -k 8084/tcp 2>/dev/null || true
    pkill -f "$APP_DIR/server/index.js" 2>/dev/null || true
    sleep 1
    systemctl --user restart "$UNIT"
    sleep 2
    systemctl --user --no-pager --full status "$UNIT" || true
    ;;
  stop)
    systemctl --user stop "$UNIT" 2>/dev/null || true
    echo "已停止 $UNIT"
    ;;
  status)
    systemctl --user --no-pager --full status "$UNIT" || true
    ss -tlnp 2>/dev/null | grep 8084 || netstat -tlnp 2>/dev/null | grep 8084 || true
    ;;
  logs)
    journalctl --user -u "$UNIT" -n 80 --no-pager
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs|install}"
    exit 1
    ;;
esac
