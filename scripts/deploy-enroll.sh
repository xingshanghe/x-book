#!/usr/bin/env bash
# 把建档账号服务部署到一台已有 Docker 的机器，并清掉这台机器上其他容器。
# 用法：scripts/deploy-enroll.sh
# 可覆盖：ENROLL_SSH=root@118.25.79.136

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${ENROLL_SSH:-root@118.25.79.136}"
REMOTE="/opt/qingyue-enroll"

rsync -az --delete \
  --exclude '.venv/' \
  --exclude '__pycache__/' \
  --exclude '.pytest_cache/' \
  --exclude '*.db' \
  --exclude '.env' \
  "$ROOT/services/voice-enroll/" "$HOST:$REMOTE/"

ssh -o BatchMode=yes "$HOST" "REMOTE='$REMOTE' bash -s" << 'EOF'
set -euo pipefail
cd "$REMOTE"

if [[ ! -f .env ]]; then
  umask 077
  jwt="$(openssl rand -hex 32)"
  admin="$(openssl rand -hex 24)"
  cat > .env << ENV
JWT_SECRET=${jwt}
ENROLL_ADMIN_TOKEN=${admin}
ENROLL_DB=/data/enroll.db
ENROLL_HOST=0.0.0.0
ENROLL_PORT=8787
ENROLL_CHARGE_CREDITS=0
ENV
  echo "已生成 /opt/qingyue-enroll/.env（口令只留在服务器上）"
fi

docker ps -a --format '{{.ID}} {{.Names}}' | while read -r id name; do
  [[ -z "${id:-}" ]] && continue
  if [[ "$name" != "qingyue-enroll" ]]; then
    docker rm -f "$id" >/dev/null
    echo "已删除容器 $name"
  fi
done

while read -r ref; do
  [[ -z "$ref" ]] && continue
  case "$ref" in
    docker.m.daocloud.io/library/python:3.12-slim|docker.m.daocloud.io/library/python:3.12-slim-bookworm|qingyue-enroll:latest)
      ;;
    *)
      docker rmi -f "$ref" >/dev/null 2>&1 || true
      echo "已删除镜像 $ref"
      ;;
  esac
done < <(docker images --format '{{.Repository}}:{{.Tag}}')

docker compose up -d --build
docker image prune -f >/dev/null
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1/v1/health; then
    ok=1
    break
  fi
  sleep 1
done
echo
[[ "$ok" == 1 ]]
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
df -h /
EOF
