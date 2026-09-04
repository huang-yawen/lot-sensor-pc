@echo off
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"

rem === 用正确的 Python 3.13 启动 YOLO 推理服务 (yolo11-flask.py) ===
rem === 服务地址: http://localhost:5000/infer  (POST, body 里放 base64 图片) ===
set "PY=C:\Users\lenovo\AppData\Local\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=python"

echo 使用解释器: %PY%
"%PY%" -c "import sys;print('Python',sys.version.split()[0])"
echo.
echo 启动 yolo11-flask.py ...  (Ctrl+C 停止)
echo.
"%PY%" yolo11-flask.py
pause
