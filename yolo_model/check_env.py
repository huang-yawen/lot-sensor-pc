# -*- coding: utf-8 -*-
"""
校验 yolo11-flask.py 运行环境是否完整可用。
用法: 双击 check_env.bat, 或  python check_env.py
把赛场模型文件放进本目录(yolo_model)后, 再跑一次即可验证赛场模型能否加载。
"""
import sys, os
import importlib.metadata as md

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print("=" * 56)
print("Python :", sys.version.split()[0], "@", sys.executable)
print("-" * 56)

need = ["ultralytics", "torch", "torchvision", "opencv-python",
        "numpy", "Flask", "flask-cors", "pillow"]
missing = []
for p in need:
    try:
        print("  {:16s} {}".format(p, md.version(p)))
    except Exception as e:
        print("  {:16s} 缺失! {}".format(p, e))
        missing.append(p)

if missing:
    print("-" * 56)
    print("以下依赖缺失, 请先运行 install_offline.bat :", ", ".join(missing))
    sys.exit(1)

print("-" * 56)
import numpy as np
import cv2
import torch
from ultralytics import YOLO

print("cv2 :", cv2.__version__,
      "| torch :", torch.__version__,
      "| CUDA可用 :", torch.cuda.is_available())
print("-" * 56)

# 找本目录下的 .pt 模型逐个试加载 + 跑一次推理
pts = [f for f in os.listdir(".") if f.lower().endswith(".pt")]
if not pts:
    print("[提示] 本目录暂无 .pt 模型文件。把赛场模型放进来后重跑本脚本即可验证。")
else:
    dummy = (np.random.rand(640, 640, 3) * 255).astype("uint8")
    for m in pts:
        try:
            model = YOLO(m)
            r = model(dummy, verbose=False)
            print("[OK] {:20s} 加载+推理成功 | 类别数={} | 本次检测框={}".format(
                m, len(model.names), len(r[0].boxes)))
        except Exception as e:
            print("[失败] {:20s} -> {}".format(m, e))

print("=" * 56)
print("环境校验完成。上面每个包都有版本号、且模型 [OK] 即代表可正常开跑。")
