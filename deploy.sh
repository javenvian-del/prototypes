#!/bin/bash

# 用法: ./deploy.sh          → 部署所有改动
#       ./deploy.sh foo.html → 部署并打开指定文件

cd "$(dirname "$0")"

git add .
git commit -m "update prototype"
git push

echo "部署完成，等待 GitHub Pages 生效..."
sleep 5

if [ -n "$1" ]; then
  open "https://javenvian-del.github.io/prototypes/$1"
else
  open "https://javenvian-del.github.io/prototypes/"
fi
