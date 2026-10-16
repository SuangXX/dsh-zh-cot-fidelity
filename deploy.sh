#!/bin/sh
# 把工作区里的源码部署到 profile 能 link 的位置（/sdcard 不支持符号链接）。
#
# 1.1.0 起改成：先拷到临时目录 → 校验 → 原子替换。
# 拷坏了不会动正在跑的那一份；部署产物不带 .git（避免副本里挂着一份过时的版本库）。
set -eu

SRC=/sdcard/dsh/plugins/dsh-zh-cot-fidelity
DST=/root/dsh-zh-cot-fidelity
TMP=/root/dsh-zh-cot-fidelity.tmp
OLD=/root/dsh-zh-cot-fidelity.old
NODE_MODULES=../../usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules

# 只允许操作这几个确定的绝对路径。
for p in "$DST" "$TMP" "$OLD"; do
  case "$p" in
    /root/dsh-zh-cot-fidelity|/root/dsh-zh-cot-fidelity.tmp|/root/dsh-zh-cot-fidelity.old) ;;
    *) echo "拒绝：路径不是预期（$p）" >&2; exit 1 ;;
  esac
done

[ -f "$SRC/package.json" ] || { echo "拒绝：$SRC 不是插件包" >&2; exit 1; }

# 1) 先拷到临时目录。
rm -rf "$TMP"
mkdir -p "$TMP"
cp -R "$SRC/." "$TMP/"
rm -rf "$TMP/.git" "$TMP/node_modules"
rm -f "$TMP/deploy.sh"

# 2) 与其他链接式插件一致：裸模块名（@deepseek-ai/schemastery 等）从这个符号链接解析。
ln -sfn "$NODE_MODULES" "$TMP/node_modules"

# 3) 入口自检：没有主入口就不替换。
[ -f "$TMP/index.js" ] || { echo "拒绝：$TMP/index.js 不存在" >&2; rm -rf "$TMP"; exit 1; }
[ -f "$TMP/prompt.js" ] || { echo "拒绝：$TMP/prompt.js 不存在" >&2; rm -rf "$TMP"; exit 1; }

# 4) 原子替换。
rm -rf "$OLD"
mv "$DST" "$OLD" 2>/dev/null || true
mv "$TMP" "$DST"
rm -rf "$OLD"

echo "已部署到 $DST"
echo "下一步：重启 DSH Web（手机 App 里重新打开）让插件重新加载。"
echo "之后改规则文本（${DSH_HOME:-$HOME/.dsh}/zh-cot-fidelity/rules/）不需要重启，下一轮组装生效。"
