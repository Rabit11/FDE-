#!/bin/bash
# Backup current fde-platform before deploy; keep data intact
set -e
REMOTE_BASE=/data_SSD_21T/users/yanghuiran/yanghuiran
APP_DIR="$REMOTE_BASE/fde-platform"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$REMOTE_BASE/fde-platform.backup.$STAMP"

echo "[backup] $APP_DIR -> $BACKUP"
if [ ! -d "$APP_DIR" ]; then
  echo "NO_APP_DIR: nothing to backup"
  exit 0
fi

cp -a "$APP_DIR" "$BACKUP"
du -sh "$BACKUP" "$BACKUP/data" 2>/dev/null || true
if [ -f "$BACKUP/data/platform.json" ]; then
  echo "DB_OK $(wc -c < "$BACKUP/data/platform.json") bytes"
else
  echo "DB_MISSING"
fi
echo "BACKUP_PATH=$BACKUP"
curl -s -o /dev/null -w "PRE_DEPLOY_HTTP %{http_code}\n" http://127.0.0.1:8084/login.html || true
