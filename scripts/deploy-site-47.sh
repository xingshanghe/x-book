#!/usr/bin/env bash
# 把官网容器化部署到 47.108.79.158，并在前面挂一台 nginx 做 www.qingyue.com 反代。
#
# 用法：
#   SSH_PASS='登录密码' scripts/deploy-site-47.sh
#   SSH_PASS='登录密码' scripts/deploy-site-47.sh --migrate-downloads
#
# 可覆盖：
#   SITE_HOST=root@47.108.79.158
#   SITE_REMOTE=/opt/qingyue-site
#   SITE_PORT=10080
#   SITE_BASE_URL=http://47.108.79.158   页面里的 canonical / og:url / 下载地址用它
#   SITE_DOWNLOAD_SOURCE=root@118.25.79.136   --migrate-downloads 时的安装包来源
#
# 如果本机已经给目标机器配好免密登录，可以省略 SSH_PASS。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${SITE_HOST:-root@47.108.79.158}"
REMOTE="${SITE_REMOTE:-/opt/qingyue-site}"
PORT="${SITE_PORT:-10080}"
BASE_URL="${SITE_BASE_URL:-http://47.108.79.158}"
DOWNLOAD_SOURCE="${SITE_DOWNLOAD_SOURCE:-root@118.25.79.136}"

MIGRATE_DOWNLOADS=0
for arg in "$@"; do
  case "$arg" in
    --migrate-downloads) MIGRATE_DOWNLOADS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

KEY="${SITE_SSH_KEY:-$HOME/.ssh/qingyue_47}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

# 优先用部署密钥：密码认证在 rsync 的多进程调用下容易触发 sshd 限流。
if [[ -f "$KEY" ]]; then
  SSH_ID=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes)
  SSH=(ssh "${SSH_OPTS[@]}" "${SSH_ID[@]}")
  RSYNC_SSH="ssh ${SSH_OPTS[*]} ${SSH_ID[*]}"
elif [[ -n "${SSH_PASS:-}" ]]; then
  export SSHPASS="$SSH_PASS"
  SSH_ID=(-o PreferredAuthentications=password -o PubkeyAuthentication=no)
  SSH=(sshpass -e ssh "${SSH_OPTS[@]}" "${SSH_ID[@]}")
  RSYNC_SSH="sshpass -e ssh ${SSH_OPTS[*]} ${SSH_ID[*]}"
else
  echo "缺少部署密钥 $KEY，也没有提供 SSH_PASS" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# ---------------------------------------------------------------- 安装包迁移
# 目标机器直连旧机器拉取，避免把 300MB+ 安装包绕回本机。
migrate_downloads() {
  local key="/root/.ssh/qy_migrate_$$"
  local marker="qingyue-migrate-$$"
  local pub rc=0

  echo "==> 建立 $HOST -> $DOWNLOAD_SOURCE 的一次性直连"
  pub="$("${SSH[@]}" "$HOST" \
    "ssh-keygen -t ed25519 -N '' -C '$marker' -f '$key' -q >/dev/null 2>&1 && cat '$key.pub'")"
  [[ -n "$pub" ]] || { echo "在目标机器生成临时密钥失败" >&2; return 1; }

  ssh -o BatchMode=yes "$DOWNLOAD_SOURCE" \
    "mkdir -p /root/.ssh && chmod 700 /root/.ssh && printf '%s\n' '$pub' >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys"

  echo "==> 从旧机器拉取安装包（约 312MB）"
  "${SSH[@]}" "$HOST" \
    "rsync -a --info=stats2 -e 'ssh -i $key -o StrictHostKeyChecking=no -o IdentitiesOnly=yes' \
       '$DOWNLOAD_SOURCE:/opt/qingyue-www/download/' '$REMOTE/downloads/'" || rc=$?

  # 无论成败都撤销授权，避免留下长期可用的密钥。
  ssh -o BatchMode=yes "$DOWNLOAD_SOURCE" \
    "sed -i '/$marker/d' /root/.ssh/authorized_keys" >/dev/null 2>&1 || true
  "${SSH[@]}" "$HOST" "rm -f '$key' '$key.pub'" >/dev/null 2>&1 || true

  if [[ "$rc" != 0 ]]; then
    echo "安装包迁移失败（rsync 退出码 ${rc}）" >&2
    return "$rc"
  fi
  echo "==> 临时密钥已撤销"
}

# ------------------------------------------------------------ 生成本次产物
echo "==> 渲染页面资源（BASE_URL=${BASE_URL}）"
mkdir -p "$STAGE/pages" "$STAGE/downloads"
rsync -a \
  "$ROOT/site/index.html" \
  "$ROOT/site/favicon.svg" \
  "$ROOT/site/robots.txt" \
  "$ROOT/site/sitemap.xml" \
  "$ROOT/site/llms.txt" \
  "$STAGE/pages/"
rsync -a "$ROOT/site/download/latest.json" "$STAGE/downloads/"

# 源码里写死的是旧机地址；部署到别的主机时按 BASE_URL 替换，仓库保持不动。
if [[ "$BASE_URL" != "http://118.25.79.136" ]]; then
  find "$STAGE" -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' -o -name '*.json' \) \
    -exec sed -i.bak "s|http://118\.25\.79\.136|${BASE_URL}|g" {} +
  find "$STAGE" -name '*.bak' -delete
fi

echo "==> 准备远程目录"
"${SSH[@]}" "$HOST" \
  "mkdir -p '$REMOTE/site/html/app' '$REMOTE/downloads' '$REMOTE/edge' '$REMOTE/minio-data'"

if [[ "$MIGRATE_DOWNLOADS" == 1 ]]; then
  migrate_downloads
fi

# MinIO 根凭据：首次部署生成，之后复用；密钥不进仓库。
ensure_minio_env() {
  local created=0
  if ! "${SSH[@]}" "$HOST" "test -f '$REMOTE/.env'"; then
    created=1
    local user pass
    user="qy$(openssl rand -hex 4)"
    pass="$(openssl rand -base64 24 | tr -d '=+/=' | head -c 32)"
    "${SSH[@]}" "$HOST" "umask 077; cat > '$REMOTE/.env' <<EOF
MINIO_ROOT_USER=$user
MINIO_ROOT_PASSWORD=$pass
EOF"
    echo "==> 已生成 MinIO 凭据（$REMOTE/.env）"
  else
    echo "==> 复用已有 MinIO 凭据（$REMOTE/.env）"
  fi
  echo "==> MinIO 密钥仅留在服务器 $REMOTE/.env（客户端改用账号密码，无需填写密钥）"
  if [[ "$created" == 1 ]]; then
    echo "==> 已生成 MinIO 根凭据；请勿提交仓库、勿发给客户端"
  fi
}

ensure_minio_env

echo "==> 同步编排与配置"
rsync -az -e "$RSYNC_SSH" "$ROOT/deploy/site-47/docker-compose.yml" "$HOST:$REMOTE/"
rsync -az -e "$RSYNC_SSH" \
  "$ROOT/deploy/site-47/site/Dockerfile" \
  "$ROOT/deploy/site-47/site/.dockerignore" \
  "$ROOT/deploy/site-47/site/default.conf" \
  "$HOST:$REMOTE/site/"
rsync -az -e "$RSYNC_SSH" "$ROOT/deploy/site-47/edge/default.conf" "$HOST:$REMOTE/edge/"
echo "==> 同步云书架 API"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude '__pycache__' --exclude '.venv' --exclude '*.pyc' \
  "$ROOT/services/book-cloud/" "$HOST:$REMOTE/book-cloud/"
# 确保 .env 含账号校验地址（不覆盖已有密钥）
"${SSH[@]}" "$HOST" "grep -q '^ACCOUNT_VERIFY_URL=' '$REMOTE/.env' 2>/dev/null || echo 'ACCOUNT_VERIFY_URL=http://118.25.79.136' >> '$REMOTE/.env'"

echo "==> 同步官网静态文件"
rsync -az -e "$RSYNC_SSH" "$STAGE/pages/" "$HOST:$REMOTE/site/html/"
rsync -az -e "$RSYNC_SSH" "$STAGE/downloads/latest.json" "$HOST:$REMOTE/downloads/latest.json"

echo "==> 同步网页阅读器到 /app/"
if [[ -d "$ROOT/dist" ]]; then
  rsync -az --delete -e "$RSYNC_SSH" "$ROOT/dist/" "$HOST:$REMOTE/site/html/app/"
else
  echo "跳过 /app/（本地尚无 dist/）"
fi

echo "==> 构建并启动容器"
"${SSH[@]}" "$HOST" "set -e; cd '$REMOTE'; docker compose up -d --build; docker compose ps"

echo "==> 健康检查"
"${SSH[@]}" "$HOST" "set -e
  curl -fsS -o /dev/null -w 'edge      (80)     %{http_code}\n' -H 'Host: www.qingyue.com' http://127.0.0.1/
  curl -fsS -o /dev/null -w 'site      ($PORT)   %{http_code}\n' http://127.0.0.1:$PORT/
  curl -fsS -o /dev/null -w 'app       (80)     %{http_code}\n' -H 'Host: www.qingyue.com' http://127.0.0.1/app/ || true
  curl -fsS -o /dev/null -w 'manifest  (80)     %{http_code}\n' -H 'Host: www.qingyue.com' http://127.0.0.1/download/latest.json
  curl -fsS -o /dev/null -w 'health    (80)     %{http_code}\n' -H 'Host: www.qingyue.com' http://127.0.0.1/healthz
  curl -fsS -o /dev/null -w 'minio     (s3)     %{http_code}\n' http://127.0.0.1/s3/minio/health/live
  echo '--- 安装包挂载 ---'
  ls -1sh '$REMOTE/downloads' | head -12
"

cat <<EOF

部署完成。
  站点直连：http://${HOST#*@}:$PORT/
  假域名入口：http://www.qingyue.com/  （本机可加 hosts：${HOST#*@} www.qingyue.com）
  网页阅读器：http://www.qingyue.com/app/
  安装包目录：http://www.qingyue.com/download/
  MinIO S3：  ${BASE_URL}/s3
EOF
