#!/usr/bin/env bash
# FDE 管理平台 · 本地一键部署运行脚本（Linux / macOS / Windows Git Bash·WSL）
#
# 用法: bash deploy/local/start.sh [start|stop|restart|status|logs|install]
#   start    停掉旧进程 -> 安装依赖 -> 后台启动（默认，一键重复执行）
#   stop     停掉本地服务
#   restart  等价于 start
#   status   查看运行状态与端口占用
#   logs     查看运行日志
#   install  仅安装依赖
#
# 可用 PORT=3457 bash deploy/local/start.sh 临时指定端口（优先级高于 .env）
set -e

if [ -n "${BASH_SOURCE:-}" ]; then SRC="${BASH_SOURCE[0]}"; else SRC="$0"; fi
ROOT="$(cd "$(dirname "$SRC")/../.." && pwd)"
PID_FILE="$ROOT/.local-server.pid"
OUT_LOG="$ROOT/local-server.out.log"
ERR_LOG="$ROOT/local-server.err.log"
DEFAULT_PORT=3456

case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) IS_WIN=1 ;;
  *) IS_WIN=0 ;;
esac

# ── 读取端口: 环境变量 > .env > 默认 3456 ─────────────────────────────
resolve_port() {
  if [ -n "${PORT:-}" ]; then return; fi
  local v=""
  if [ -f "$ROOT/.env" ]; then
    v="$(grep -E '^[[:space:]]*PORT=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d ' \r')"
  fi
  PORT="${v:-$DEFAULT_PORT}"
}
resolve_port
export PORT

# ── 工具函数 ──────────────────────────────────────────────────────────
kill_pid() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  if [ "$IS_WIN" = "1" ]; then
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  else
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

# 查询占用端口的进程号（跨平台，去重）
port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $NF}' | grep -oE '[0-9]+' || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -iE 'listen' | grep -E "[:.]$PORT[[:space:]]+.*[0-9]+[[:space:]]*$" | awk '{print $NF}' || true
  fi | sort -u
}

stop_server() {
  # 1) pid 文件记录的进程
  if [ -f "$PID_FILE" ]; then
    kill_pid "$(cat "$PID_FILE" 2>/dev/null | tr -d ' \r\n')"
  fi
  # 2) 端口占用进程
  local pids; pids="$(port_pids)"
  for pid in $pids; do kill_pid "$pid"; done
  # 3) 兜底：按进程名清理
  pkill -f "server/index.js" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "已停止本地服务（端口 $PORT）"
}

ensure_env() {
  if [ ! -f "$ROOT/.env" ]; then
    cp "$ROOT/deploy/local/env.example" "$ROOT/.env"
    echo "已创建 .env（PORT=$DEFAULT_PORT）"
  fi
}

install_deps() {
  cd "$ROOT"
  if [ -d node_modules ] && [ "${1:-}" != "force" ]; then
    echo "依赖已存在，跳过 npm install"
  else
    echo "安装依赖: npm install"
    npm install --silent
  fi
}

start_server() {
  ensure_env
  resolve_port; export PORT
  if ! command -v node >/dev/null 2>&1; then
    echo "未找到 node，请先安装 Node.js（https://nodejs.org）" >&2
    exit 1
  fi

  stop_server
  install_deps

  echo "启动本地服务: http://localhost:$PORT"
  cd "$ROOT"
  : > "$OUT_LOG"; : > "$ERR_LOG"
  nohup node server/index.js >"$OUT_LOG" 2>"$ERR_LOG" &
  echo $! > "$PID_FILE"
  sleep 2

  if ! command -v curl >/dev/null 2>&1; then
    echo "已启动（未找到 curl，跳过健康检查）: http://localhost:$PORT"
    return 0
  fi

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login.html" 2>/dev/null || echo 000)"
  echo "健康检查: HTTP $code"
  if [ "$code" != "200" ]; then
    echo "启动失败，最近日志:" >&2
    tail -20 "$ERR_LOG" >&2 || true
    tail -20 "$OUT_LOG" >&2 || true
    exit 1
  fi
  echo "访问: http://localhost:$PORT"
  echo "日志: bash deploy/local/start.sh logs   停止: bash deploy/local/start.sh stop"
}

show_status() {
  local pid=""
  [ -f "$PID_FILE" ] && pid="$(cat "$PID_FILE" 2>/dev/null | tr -d ' \r\n')"
  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "运行中 (pid $pid)  http://localhost:$PORT"
  elif [ -n "$(port_pids)" ]; then
    echo "运行中 (端口 $PORT 已被占用)"
  else
    echo "未运行"
  fi
  port_pids | sed 's/^/占用端口进程 pid: /' || true
}

case "${1:-start}" in
  start|restart) start_server ;;
  stop)          stop_server ;;
  status)        resolve_port; show_status ;;
  logs)          resolve_port; tail -50 "$OUT_LOG" 2>/dev/null || true; echo "--- err ---"; tail -50 "$ERR_LOG" 2>/dev/null || true ;;
  install)       install_deps force ;;
  *) echo "用法: bash $SRC {start|stop|restart|status|logs|install}"; exit 1 ;;
esac
