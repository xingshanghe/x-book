#!/usr/bin/env bash
#
# 一步发布：推代码 → 打 tag → 建 Release → 上传本地已有产物。
#
# 前置：
#   1) gh auth login                      # 需要 contents 写权限
#   2) 先把想要的安装包 build 出来放在 release/ 里，例如：
#        make pack-web
#        make pack-macos
#
# 用法：
#   scripts/publish-release.sh 1.0.0
#   scripts/publish-release.sh 1.0.0 --skip-push   # 已经推过代码时
#
set -euo pipefail

V="${1:-}"
if [[ -z "$V" ]]; then
  echo "用法: scripts/publish-release.sh <version>  # 例：1.0.0"
  exit 1
fi
V="${V#v}"
TAG="v$V"

cd "$(dirname "$0")/.."

NOTES="$(mktemp -t qingyue-release-notes)"

cat > "$NOTES" <<EOF
## 轻阅 ${TAG}

本地优先、**完全离线**的 txt 阅读器。参考易笺的阅读形态，但去掉它的网络依赖、体积上限与无书签的限制。

### 下载

| 平台 | 文件 |
|---|---|
| macOS | \`qingyue-${V}-macos-*.zip\` / \`.dmg\` —— 解压拖进「应用程序」即可 |
| Windows | \`*_x64-setup.exe\` (NSIS) / \`.msi\` |
| Linux | \`.deb\` / \`.AppImage\` |
| Android | \`.apk\` / \`.aab\` |
| iOS | \`.ipa\` |
| Web / PWA | \`qingyue-web-${V}.zip\` —— 解压后任意静态托管即可离线使用 |
| HarmonyOS | 需本地 DevEco Studio 构建，见 docs/build.md |

> Android / iOS / HarmonyOS 未配置签名时是可安装的调试包，可直接装到真机自测。

### 这一版有什么

- **秒开**：UTF-8 归一 + 16 KB 块索引，任意大书流式读取，全文不入内存
- **纯离线**：导入、书架、阅读、排版、书签、进度、搜索、字体，零网络请求
- **渐进增强**：同步只留接口 + 单机模式；Worker 不可用时退化主线程解析
- **多端**：响应式三档 + PWA + Tauri 桌面/移动 + ArkTS 鸿蒙外壳
EOF

if [[ "${2:-}" != "--skip-push" ]]; then
  echo "→ 推送 main"
  git push origin main
fi

echo "→ 打 tag $TAG"
git tag -fa "$TAG" -m "轻阅 $TAG"
git push origin "$TAG" --force

echo "→ 创建 / 更新 GitHub Release $TAG"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" --title "轻阅 $TAG" --notes-file "$NOTES"
else
  gh release create "$TAG" --title "轻阅 $TAG" --notes-file "$NOTES"
fi
rm -f "$NOTES"

if compgen -G "release/*" > /dev/null; then
  echo "→ 上传 release/ 下的产物"
  gh release upload "$TAG" release/* --clobber
else
  echo "  release/ 为空，跳过上传（CI 由 Actions 补充）"
fi

echo ""
echo "✓ Release: https://github.com/xingshanghe/x-book/releases/tag/$TAG"
echo "  Windows / Linux / Android / iOS 由 Actions 并行构建后自动追加："
echo "  https://github.com/xingshanghe/x-book/actions"
