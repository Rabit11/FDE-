# 远程部署（10.90.111.114:8084）

服务以 **systemd --user** 守护运行：退出 SSH、关闭本机电脑后，平台仍在服务器后台持续运行；进程崩溃会自动重启。

## 服务器路径
| 用途 | 路径 |
|------|------|
| 应用目录 | `/data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform` |
| 部署包 | `/data_SSD_21T/users/yanghuiran/yanghuiran/fde-deploy.tgz` |
| 部署脚本 | `/data_SSD_21T/users/yanghuiran/yanghuiran/deploy-8084.sh` |
| systemd 单元 | `~/.config/systemd/user/fde-platform.service` |
| 运行日志 | `fde-platform/fde.log` + `journalctl --user -u fde-platform` |

## 从本机一键部署
```powershell
cd C:\Users\81172\Desktop\敏捷管理平台
.\deploy\remote\push-deploy.ps1
```

## 服务器上手动运维
```bash
cd /data_SSD_21T/users/yanghuiran/yanghuiran/fde-platform

# 状态 / 启停 / 重启
bash start.sh status
bash start.sh start
bash start.sh stop
bash start.sh restart

# 等价命令
systemctl --user status fde-platform
systemctl --user restart fde-platform
journalctl --user -u fde-platform -f
```

## 后台常驻说明
1. 首次部署会执行 `loginctl enable-linger`，即使用户注销 SSH，user 级服务仍保持运行
2. `Restart=always`：Node 异常退出后约 3 秒自动拉起
3. **仅关闭你自己的电脑不会停服务**（服务跑在服务器上）；只有服务器关机/重启才会中断，重启后若 linger 已启用会自动拉起

## 访问
http://10.90.111.114:8084
