# 静态站点镜像：官网页面 + /app 下的网页阅读器。
# 大会安装包不在这里：compose 把宿主 downloads/ 只读挂到 /usr/share/nginx/html/download。
FROM nginx:1.27-alpine

COPY default.conf /etc/nginx/conf.d/default.conf
COPY html/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
