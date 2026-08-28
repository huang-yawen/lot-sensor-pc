@echo off
chcp 65001 >nul
setlocal

set "SERVER_DIR=%~dp0backend\server"
set "NODE_EXE=D:\Program Files\node.js\node.exe"
set "OUT_LOG=%SERVER_DIR%\node-out.log"
set "ERR_LOG=%SERVER_DIR%\node-err.log"

echo ====================================
echo   LOT 传感器项目 - 后端启动脚本
echo ====================================
echo.

echo [1/2] 检查 3000 端口是否已被占用...
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($conn) { $ids = $conn.OwningProcess | Sort-Object -Unique; foreach ($procId in $ids) { Write-Host ('  发现占用进程 PID=' + $procId + '，正在停止...'); Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2 } else { Write-Host '  端口空闲，无需处理。' }"

echo.
echo [2/2] 启动后端（node app.js，后台运行）...
powershell -NoProfile -Command "$p = Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'app.js' -WorkingDirectory '%SERVER_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%OUT_LOG%' -RedirectStandardError '%ERR_LOG%' -PassThru; Write-Host ('  已启动，PID=' + $p.Id)"

echo.
echo 完成。日志文件：
echo   %OUT_LOG%
echo   %ERR_LOG%
echo.
pause
