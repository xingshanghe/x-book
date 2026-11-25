"""
云书架 API：客户端只带账号 Bearer；MinIO 密钥留在服务端。
校验方式：转发 Authorization 到账号服务 /v1/auth/me。
对象前缀：users/{accountId}/books/{fingerprint}/
"""

from __future__ import annotations

import io
import json
import os
import re
from typing import Any

import httpx
from fastapi import FastAPI, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from minio import Minio
from minio.error import S3Error

ACCOUNT_VERIFY_URL = os.environ.get("ACCOUNT_VERIFY_URL", "http://118.25.79.136").rstrip("/")
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ROOT_USER", "")
MINIO_SECRET_KEY = os.environ.get("MINIO_ROOT_PASSWORD", "")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "qingyue-books")
MINIO_SECURE = os.environ.get("MINIO_SECURE", "0") == "1"
FP_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def _ok(data: Any) -> dict[str, Any]:
    return {"success": True, "code": 0, "message": "ok", "data": data}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "code": status, "message": message, "data": None},
    )


def create_app() -> FastAPI:
    app = FastAPI(title="qingyue-book-cloud", docs_url=None, redoc_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    def minio_client() -> Minio:
        return Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE,
        )

    def ensure_bucket(client: Minio) -> None:
        if not client.bucket_exists(MINIO_BUCKET):
            client.make_bucket(MINIO_BUCKET)

    async def account_id(authorization: str) -> str | JSONResponse:
        if not authorization.startswith("Bearer "):
            return _err(401, "请先登录账号")
        try:
            async with httpx.AsyncClient(timeout=8.0) as http:
                res = await http.get(
                    f"{ACCOUNT_VERIFY_URL}/v1/auth/me",
                    headers={"Authorization": authorization},
                )
        except httpx.HTTPError:
            return _err(503, "账号服务暂时不可用")
        if res.status_code == 401:
            return _err(401, "登录已过期，请重新登录")
        if res.status_code != 200:
            return _err(502, "无法校验账号")
        try:
            body = res.json()
            aid = (body.get("data") or {}).get("id")
        except Exception:
            return _err(502, "账号服务返回异常")
        if not aid or not isinstance(aid, str):
            return _err(401, "请先登录账号")
        return aid

    def prefix(aid: str) -> str:
        return f"users/{aid}/books/"

    def object_keys(aid: str, fingerprint: str) -> tuple[str, str]:
        base = f"users/{aid}/books/{fingerprint}"
        return f"{base}/meta.json", f"{base}/file.bin"

    def check_fp(fingerprint: str) -> str | None:
        if not FP_RE.match(fingerprint):
            return "无效的书籍指纹"
        return None

    @app.get("/v1/books/cloud/health")
    def health():
        return _ok({"ok": True})

    @app.get("/v1/books/cloud")
    async def list_books(authorization: str = Header(default="")):
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        client = minio_client()
        try:
            ensure_bucket(client)
            items: list[dict[str, Any]] = []
            for obj in client.list_objects(MINIO_BUCKET, prefix=prefix(aid), recursive=True):
                name = obj.object_name or ""
                if not name.endswith("/meta.json"):
                    continue
                try:
                    resp = client.get_object(MINIO_BUCKET, name)
                    try:
                        meta = json.loads(resp.read().decode("utf-8"))
                    finally:
                        resp.close()
                        resp.release_conn()
                    # fingerprint 以路径为准
                    mid = name[len(prefix(aid)) : -len("/meta.json")]
                    if "/" in mid or not mid:
                        continue
                    if not isinstance(meta, dict):
                        continue
                    meta["fingerprint"] = mid
                    items.append(meta)
                except Exception:
                    continue
            items.sort(key=lambda m: int(m.get("uploadedAt") or 0), reverse=True)
            return _ok({"items": items})
        except S3Error as e:
            return _err(502, f"对象存储错误：{e.code}")

    @app.put("/v1/books/cloud/{fingerprint}/file")
    async def put_file(fingerprint: str, request: Request, authorization: str = Header(default="")):
        bad = check_fp(fingerprint)
        if bad:
            return _err(400, bad)
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        body = await request.body()
        if not body:
            return _err(400, "文件为空")
        if len(body) > 300 * 1024 * 1024:
            return _err(413, "文件过大")
        content_type = request.headers.get("content-type") or "application/octet-stream"
        _, file_key = object_keys(aid, fingerprint)
        client = minio_client()
        try:
            ensure_bucket(client)
            client.put_object(
                MINIO_BUCKET,
                file_key,
                io.BytesIO(body),
                length=len(body),
                content_type=content_type,
            )
            return _ok({"ok": True, "size": len(body)})
        except S3Error as e:
            return _err(502, f"上传失败：{e.code}")

    @app.put("/v1/books/cloud/{fingerprint}/meta")
    async def put_meta(fingerprint: str, request: Request, authorization: str = Header(default="")):
        bad = check_fp(fingerprint)
        if bad:
            return _err(400, bad)
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        try:
            meta = await request.json()
        except Exception:
            return _err(400, "元数据不是 JSON")
        if not isinstance(meta, dict):
            return _err(400, "元数据格式错误")
        meta["fingerprint"] = fingerprint
        raw = json.dumps(meta, ensure_ascii=False).encode("utf-8")
        meta_key, _ = object_keys(aid, fingerprint)
        client = minio_client()
        try:
            ensure_bucket(client)
            client.put_object(
                MINIO_BUCKET,
                meta_key,
                io.BytesIO(raw),
                length=len(raw),
                content_type="application/json",
            )
            return _ok(meta)
        except S3Error as e:
            return _err(502, f"上传失败：{e.code}")

    @app.get("/v1/books/cloud/{fingerprint}/meta")
    async def get_meta(fingerprint: str, authorization: str = Header(default="")):
        bad = check_fp(fingerprint)
        if bad:
            return _err(400, bad)
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        meta_key, _ = object_keys(aid, fingerprint)
        client = minio_client()
        try:
            resp = client.get_object(MINIO_BUCKET, meta_key)
            try:
                meta = json.loads(resp.read().decode("utf-8"))
            finally:
                resp.close()
                resp.release_conn()
            if isinstance(meta, dict):
                meta["fingerprint"] = fingerprint
            return _ok(meta)
        except S3Error as e:
            if e.code in ("NoSuchKey", "NoSuchBucket"):
                return _err(404, "云端没有这本书")
            return _err(502, f"读取失败：{e.code}")

    @app.get("/v1/books/cloud/{fingerprint}/file")
    async def get_file(fingerprint: str, authorization: str = Header(default="")):
        bad = check_fp(fingerprint)
        if bad:
            return _err(400, bad)
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        _, file_key = object_keys(aid, fingerprint)
        client = minio_client()
        try:
            resp = client.get_object(MINIO_BUCKET, file_key)

            def stream():
                try:
                    while True:
                        chunk = resp.read(1024 * 256)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    resp.close()
                    resp.release_conn()

            return StreamingResponse(
                stream(),
                media_type=resp.headers.get("Content-Type", "application/octet-stream"),
                headers={"Content-Length": resp.headers.get("Content-Length", "")},
            )
        except S3Error as e:
            if e.code in ("NoSuchKey", "NoSuchBucket"):
                return _err(404, "云端没有这本书")
            return _err(502, f"下载失败：{e.code}")

    @app.get("/v1/books/cloud/{fingerprint}/exists")
    async def exists(fingerprint: str, authorization: str = Header(default="")):
        bad = check_fp(fingerprint)
        if bad:
            return _err(400, bad)
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        meta_key, file_key = object_keys(aid, fingerprint)
        client = minio_client()
        try:
            ensure_bucket(client)
            client.stat_object(MINIO_BUCKET, meta_key)
            client.stat_object(MINIO_BUCKET, file_key)
            return _ok({"exists": True})
        except S3Error:
            return _ok({"exists": False})

    @app.delete("/v1/books/cloud/{fingerprint}")
    async def delete_book(fingerprint: str, authorization: str = Header(default="")):
        bad = check_fp(fingerprint)
        if bad:
            return _err(400, bad)
        aid = await account_id(authorization)
        if isinstance(aid, JSONResponse):
            return aid
        meta_key, file_key = object_keys(aid, fingerprint)
        client = minio_client()
        try:
            ensure_bucket(client)
            # MinIO remove_object 对不存在的对象也成功，幂等即可
            for key in (meta_key, file_key):
                try:
                    client.remove_object(MINIO_BUCKET, key)
                except S3Error as e:
                    if e.code not in ("NoSuchKey", "NoSuchBucket"):
                        return _err(502, f"删除失败：{e.code}")
            return _ok({"ok": True})
        except S3Error as e:
            return _err(502, f"删除失败：{e.code}")

    return app


app = create_app()
