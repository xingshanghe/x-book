#!/usr/bin/env bash
# 把官网页面同步到 118，不改账号服务的容器，也不删除安装包。
# 用法：scripts/publish-site.sh
# 可覆盖：SITE_SSH=root@118.25.79.136

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${SITE_SSH:-root@118.25.79.136}"
REMOTE="/opt/qingyue-www"

ssh -o BatchMode=yes "$HOST" "mkdir -p '$REMOTE/download'"
rsync -az \
  "$ROOT/site/index.html" \
  "$ROOT/site/favicon.svg" \
  "$ROOT/site/robots.txt" \
  "$ROOT/site/sitemap.xml" \
  "$ROOT/site/llms.txt" \
  "$HOST:$REMOTE/"
rsync -az "$ROOT/site/download/latest.json" "$HOST:$REMOTE/download/latest.json"
ssh -o BatchMode=yes "$HOST" "curl -fsS -o /dev/null -w 'home %{http_code}\n' http://127.0.0.1/ && curl -fsS -o /dev/null -w 'robots %{http_code}\n' http://127.0.0.1/robots.txt && curl -fsS -o /dev/null -w 'llms %{http_code}\n' http://127.0.0.1/llms.txt && curl -fsS http://127.0.0.1/download/latest.json"
