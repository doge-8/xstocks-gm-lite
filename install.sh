#!/bin/bash
if ! command -v node &> /dev/null; then
  echo "未检测到 Node.js，正在安装..."
  if [ "$(uname)" = "Darwin" ]; then
    brew install node
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
fi
npm install
echo "安装完成"
