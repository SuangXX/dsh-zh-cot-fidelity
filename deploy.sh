#!/bin/sh
# 把工作区里的源码部署到 profile 能 link 的位置（/sdcard 不支持符号链接）。
set -eu

SRC=/sdcard/dsh/plugins/dsh-zh-cot-fidelity
DST=/root/dsh-zh-cot-fidelity

# 只允许操作这一个确定的绝对路径。
case "$DST" in
  /root/dsh-zh-cot-fidelity) ;;
  *) echo "拒绝：DST 不是预期路径（$DST）" >&2; exit 1 ;;
esac

[ -f "$SRC/package.json" ] || { echo "拒绝：$SRC 不是插件包" >&2; exit 1; }

rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC/." "$DST/"
rm -f "$DST/deploy.sh"

# 与其他链接式插件一致：裸模块名（@deepseek-ai/schemastery 等）从这个符号链接解析。
ln -sfn ../../usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules "$DST/node_modules"

echo "已部署到 $DST"
echo "下一步：重启 DSH Web（手机 App 里重新打开）让插件重新加载。"
