#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  echo "首次运行，正在安装依赖..."
  bash install.sh || { echo "依赖安装失败"; exit 1; }
fi
node say-gm.js
