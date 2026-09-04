@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"

rem === 用离线包(offline_deps\wheels)安装锁定版本依赖, 全程不联网 ===
set "PY=C:\Users\lenovo\AppData\Local\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=python"

echo ============================================================
echo   离线安装 yolo11-flask.py 运行依赖 (锁定版本, 不联网)
echo   使用解释器: %PY%
echo ============================================================
echo.

"%PY%" -m pip install --no-index --find-links="%~dp0offline_deps\wheels" -r "%~dp0offline_deps\requirements-lock.txt"
if errorlevel 1 goto err

echo.
echo [完成] 依赖已安装。开始校验环境...
echo.
"%PY%" "%~dp0check_env.py"
goto end

:err
echo.
echo ============================================================
echo   安装失败。把上面的报错整段发出来。
echo   常见处理: 若提示已安装但版本不符, 改用强制重装:
echo   "%PY%" -m pip install --no-index --find-links=offline_deps\wheels ^
echo       --force-reinstall -r offline_deps\requirements-lock.txt
echo ============================================================

:end
echo.
pause
