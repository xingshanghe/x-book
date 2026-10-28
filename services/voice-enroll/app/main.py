from __future__ import annotations

import base64
import os
import sqlite3
import sys
import time
import uuid
from datetime import date
from pathlib import Path

import jwt
from fastapi import FastAPI, File, Form, Header, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


class AuthBody(BaseModel):
    username: str = ""
    password: str = ""


class RefreshBody(BaseModel):
    refreshToken: str = ""


class PasswordBody(BaseModel):
    oldPassword: str = ""
    newPassword: str = ""


class CreditsBody(BaseModel):
    username: str = ""
    amount: int = 0


class SponsorBody(BaseModel):
    channel: str = ""


class SponsorRecordBody(BaseModel):
    name: str = ""
    phone: str = ""
    paidOn: str = ""
    note: str = ""

from app.passwords import generate_salt, hash_password, verify_password
from app.pipeline import inspect_wav

ACCESS_TTL = 3600
REFRESH_TTL = 7 * 24 * 3600
LOCK_AFTER = 5
LOCK_SECONDS = 15 * 60


class Clock:
    """停表。测试用 advance 推时间，生产环境不要用它签发令牌。"""

    def __init__(self) -> None:
        self._now = int(time.time())

    def now(self) -> int:
        return self._now

    def advance(self, seconds: int) -> None:
        self._now += seconds


class LiveClock:
    """每次读取当前时间。访问令牌只有一小时，时钟停在进程启动时会一签发就过期。"""

    def now(self) -> int:
        return int(time.time())


ENGINE_FILES = {
    "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2",
    "vocos_24khz.onnx",
    "sherpa-onnx-v2.0.0-osx-arm64-shared.tar.bz2",
}

VOICE_TOTAL = 3
CUSTOM_VOICE_LIMIT = 2
QR_FILES = {
    "wechat": Path(__file__).resolve().parent / "static" / "sponsor-wechat.png",
    "alipay": Path(__file__).resolve().parent / "static" / "sponsor-alipay.png",
}
SPONSOR_CHANNELS = {"wechat", "alipay"}
VOICE_FULL = "最多保留 3 个音色（含引擎示例），请先删掉一个"


def create_app(
    db_path: str,
    jwt_secret: str,
    admin_token: str | None = None,
    clock: Clock | None = None,
    upload_dir: str | None = None,
    tts_dir: str | None = None,
    charge_credits: bool = True,
    site_dir: str | None = None,
) -> FastAPI:
    if not jwt_secret.strip():
        raise RuntimeError("JWT_SECRET is required")
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.db_path = db_path
    app.state.secret = jwt_secret
    app.state.clock = clock or LiveClock()
    app.state.upload_dir = upload_dir or str(Path(db_path).parent)
    app.state.tts_dir = tts_dir or ""
    app.state.charge_credits = charge_credits
    app.state.site_dir = site_dir or ""
    Path(app.state.upload_dir).mkdir(parents=True, exist_ok=True)
    _migrate(db_path)
    _routes(app, admin_token)
    _mount_site(app)
    return app


def serve() -> None:
    secret = os.environ.get("JWT_SECRET", "").strip()
    if not secret:
        print("JWT_SECRET is required", file=sys.stderr)
        raise SystemExit(1)
    admin = os.environ.get("ENROLL_ADMIN_TOKEN", "").strip() or None
    db_path = os.environ.get("ENROLL_DB", "enroll.db")
    host = os.environ.get("ENROLL_HOST", "127.0.0.1")
    port = int(os.environ.get("ENROLL_PORT", "8787"))
    tts_dir = os.environ.get("ENROLL_TTS_DIR", "").strip() or None
    # 音色管理不再按次扣次数。这个开关只继续出现在健康检查里。
    charge_credits = os.environ.get("ENROLL_CHARGE_CREDITS", "0").strip().lower() in {"1", "true", "yes", "on"}
    site_dir = os.environ.get("ENROLL_SITE_DIR", "").strip() or None
    import uvicorn

    uvicorn.run(
        create_app(
            db_path,
            secret,
            admin,
            tts_dir=tts_dir,
            charge_credits=charge_credits,
            site_dir=site_dir,
        ),
        host=host,
        port=port,
    )


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _migrate(path: str) -> None:
    with _connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              salt TEXT NOT NULL,
              status INTEGER NOT NULL DEFAULT 0,
              failure_count INTEGER NOT NULL DEFAULT 0,
              updated_at INTEGER NOT NULL,
              last_login INTEGER NOT NULL DEFAULT 0,
              login_ip TEXT NOT NULL DEFAULT '',
              enroll_credits INTEGER NOT NULL DEFAULT 0,
              sponsored_at INTEGER NOT NULL DEFAULT 0,
              sponsor_channel TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS refresh_tokens (
              jti TEXT PRIMARY KEY,
              account_id TEXT NOT NULL,
              expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS voices (
              id TEXT PRIMARY KEY,
              account_id TEXT NOT NULL,
              ref_text TEXT NOT NULL,
              quality REAL NOT NULL,
              wav BLOB NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sponsor_records (
              id TEXT PRIMARY KEY,
              account_id TEXT NOT NULL,
              name TEXT NOT NULL,
              phone TEXT NOT NULL,
              paid_on TEXT NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL
            );
            """
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)")}
        if "sponsored_at" not in columns:
            conn.execute("ALTER TABLE accounts ADD COLUMN sponsored_at INTEGER NOT NULL DEFAULT 0")
        if "sponsor_channel" not in columns:
            conn.execute("ALTER TABLE accounts ADD COLUMN sponsor_channel TEXT NOT NULL DEFAULT ''")


def _ok(data):
    return {"success": True, "code": 0, "message": "ok", "data": data}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": status, "message": message, "data": None})


def _routes(app: FastAPI, admin_token: str | None) -> None:
    @app.get("/v1/health")
    def health():
        return _ok({"ok": True, "chargeCredits": app.state.charge_credits})

    @app.post("/v1/auth/register")
    def register(body: AuthBody):
        username = body.username.strip().lower()
        password = body.password
        if len(username) < 3 or len(username) > 32 or not username.replace("_", "").isalnum():
            return _err(400, "用户名需要 3 到 32 位字母、数字或下划线")
        if len(password) < 8 or len(password) > 64:
            return _err(400, "口令至少 8 位")
        now = app.state.clock.now()
        salt = generate_salt()
        try:
            with _connect(app.state.db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO accounts (id, username, password_hash, salt, status, failure_count, updated_at, last_login, login_ip, enroll_credits)
                    VALUES (?, ?, ?, ?, 0, 0, ?, 0, '', 0)
                    """,
                    (uuid.uuid4().hex, username, hash_password(password, salt), salt, now),
                )
        except sqlite3.IntegrityError:
            return _err(409, "用户名已注册")
        return _issue(app, username)

    @app.post("/v1/auth/login")
    def login(body: AuthBody):
        username = body.username.strip().lower()
        password = body.password
        message = "用户名或口令不正确"
        with _connect(app.state.db_path) as conn:
            row = conn.execute("SELECT * FROM accounts WHERE username = ?", (username,)).fetchone()
        if row is None or row["status"] != 0:
            verify_password(_dummy_hash(), password, "000000")
            return _err(401, message)
        now = app.state.clock.now()
        if row["failure_count"] >= LOCK_AFTER and now < row["updated_at"] + LOCK_SECONDS:
            return _err(423, "登录已锁定 15 分钟")
        if row["failure_count"] >= LOCK_AFTER and now >= row["updated_at"] + LOCK_SECONDS:
            with _connect(app.state.db_path) as conn:
                conn.execute("UPDATE accounts SET failure_count = 0, updated_at = ? WHERE id = ?", (now, row["id"]))
            row = _reload(app, row["id"])
        if not verify_password(row["password_hash"], password, row["salt"]):
            with _connect(app.state.db_path) as conn:
                conn.execute(
                    "UPDATE accounts SET failure_count = failure_count + 1, updated_at = ? WHERE id = ?",
                    (now, row["id"]),
                )
            return _err(401, message)
        with _connect(app.state.db_path) as conn:
            conn.execute(
                "UPDATE accounts SET failure_count = 0, last_login = ?, updated_at = ? WHERE id = ?",
                (now, now, row["id"]),
            )
        return _issue(app, username)

    @app.post("/v1/auth/refresh")
    def refresh(body: RefreshBody):
        token = body.refreshToken
        try:
            payload = jwt.decode(token, app.state.secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            return _err(401, "未登录")
        if payload.get("typ") != "refresh":
            return _err(401, "未登录")
        with _connect(app.state.db_path) as conn:
            row = conn.execute("SELECT account_id FROM refresh_tokens WHERE jti = ?", (payload.get("jti"),)).fetchone()
            if row is None:
                return _err(401, "未登录")
            conn.execute("DELETE FROM refresh_tokens WHERE jti = ?", (payload.get("jti"),))
            account = conn.execute("SELECT username FROM accounts WHERE id = ?", (row["account_id"],)).fetchone()
        if account is None:
            return _err(401, "未登录")
        return _issue(app, account["username"])

    @app.post("/v1/auth/logout")
    def logout(body: RefreshBody):
        token = body.refreshToken
        try:
            payload = jwt.decode(token, app.state.secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            return _err(401, "未登录")
        with _connect(app.state.db_path) as conn:
            conn.execute("DELETE FROM refresh_tokens WHERE jti = ?", (payload.get("jti"),))
        return _ok({"success": True})

    @app.get("/v1/auth/me")
    def me(authorization: str = Header(default="")):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        with _connect(app.state.db_path) as conn:
            voice_count = _voice_count(conn, account["id"])
        return _ok(_profile(app, account, voice_count))

    @app.post("/v1/auth/password")
    def change_password(body: PasswordBody, authorization: str = Header(default="")):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        if len(body.newPassword) < 8 or len(body.newPassword) > 64:
            return _err(400, "口令至少 8 位")
        if not verify_password(account["password_hash"], body.oldPassword, account["salt"]):
            return _err(401, "原口令不正确")
        salt = generate_salt()
        now = app.state.clock.now()
        with _connect(app.state.db_path) as conn:
            conn.execute(
                "UPDATE accounts SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?",
                (hash_password(body.newPassword, salt), salt, now, account["id"]),
            )
            conn.execute("DELETE FROM refresh_tokens WHERE account_id = ?", (account["id"],))
        return _issue(app, account["username"])

    @app.get("/v1/sponsor")
    def sponsor_offer():
        return _ok(_sponsor_offer())

    @app.get("/v1/sponsor/qrcode/{channel}")
    def sponsor_qr(channel: str):
        path = QR_FILES.get(channel)
        if path is None or not path.is_file():
            return _err(404, "收款码还没放好")
        return FileResponse(path, media_type="image/png")

    @app.post("/v1/account/sponsor")
    def claim_sponsor(body: SponsorBody, authorization: str = Header(default="")):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        if body.channel not in SPONSOR_CHANNELS:
            return _err(400, "请选择微信或支付宝")
        now = app.state.clock.now()
        if int(account["sponsored_at"] or 0) <= 0:
            with _connect(app.state.db_path) as conn:
                conn.execute(
                    """
                    UPDATE accounts
                    SET sponsored_at = ?, sponsor_channel = ?, updated_at = ?
                    WHERE id = ? AND sponsored_at = 0
                    """,
                    (now, body.channel, now, account["id"]),
                )
        fresh = _reload(app, account["id"])
        return _ok(
            {
                "sponsored": True,
                "channel": fresh["sponsor_channel"] if fresh is not None else body.channel,
            }
        )

    @app.post("/v1/sponsor/records")
    def submit_sponsor_record(body: SponsorRecordBody, authorization: str = Header(default="")):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        name = body.name.strip()
        phone = body.phone.strip()
        paid_on = body.paidOn.strip()
        note = body.note.strip()
        if not name or len(name) > 32:
            return _err(400, "请填写赞助人")
        if len(phone) != 11 or not phone.startswith("1") or not phone.isdigit():
            return _err(400, "请填写手机号")
        try:
            date.fromisoformat(paid_on)
        except ValueError:
            return _err(400, "请填写日期")
        if len(note) > 200:
            return _err(400, "备注太长")
        record_id = uuid.uuid4().hex
        now = app.state.clock.now()
        with _connect(app.state.db_path) as conn:
            conn.execute(
                """
                INSERT INTO sponsor_records (id, account_id, name, phone, paid_on, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (record_id, account["id"], name, phone, paid_on, note, now),
            )
        return _ok({"id": record_id})

    @app.post("/v1/voices/enroll")
    async def enroll(
        audio: UploadFile = File(...),
        transcript: str = Form(default=""),
        consent: str = Form(default=""),
        authorization: str = Header(default=""),
    ):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        if consent != "true":
            return _err(400, "请先确认已获授权")
        raw = await audio.read()
        if len(raw) > 3_000_000:
            return _err(400, "文件太大")
        target = Path(app.state.upload_dir) / f"{uuid.uuid4().hex}.wav"
        target.write_bytes(raw)
        try:
            checked = inspect_wav(raw, transcript)
            if isinstance(checked, str):
                return _err(400, checked)
            wav, ref_text, quality = checked
            voice_id = uuid.uuid4().hex
            now = app.state.clock.now()
            with _connect(app.state.db_path) as conn:
                if _voice_count(conn, account["id"]) >= CUSTOM_VOICE_LIMIT:
                    return _err(409, VOICE_FULL)
                conn.execute(
                    "INSERT INTO voices (id, account_id, ref_text, quality, wav, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (voice_id, account["id"], ref_text, quality, wav, now),
                )
            return _ok({"id": voice_id, "refText": ref_text, "quality": quality})
        finally:
            target.unlink(missing_ok=True)

    @app.get("/v1/voices")
    def list_voices(authorization: str = Header(default="")):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        with _connect(app.state.db_path) as conn:
            rows = conn.execute(
                "SELECT id, ref_text, quality, wav, created_at FROM voices WHERE account_id = ? ORDER BY created_at",
                (account["id"],),
            ).fetchall()
        return _ok(
            [
                {
                    "id": row["id"],
                    "refText": row["ref_text"],
                    "quality": row["quality"],
                    "wavBase64": base64.b64encode(row["wav"]).decode("ascii"),
                    "createdAt": row["created_at"],
                }
                for row in rows
            ]
        )

    @app.delete("/v1/voices/{voice_id}")
    def delete_voice(voice_id: str, authorization: str = Header(default="")):
        account = _account_from_access(app, authorization)
        if isinstance(account, JSONResponse):
            return account
        with _connect(app.state.db_path) as conn:
            cur = conn.execute("DELETE FROM voices WHERE id = ? AND account_id = ?", (voice_id, account["id"]))
            if cur.rowcount == 0:
                return _err(404, "找不到")
        return _ok({"success": True})

    if admin_token:
        @app.post("/v1/admin/credits")
        def add_credits(body: CreditsBody, authorization: str = Header(default="")):
            if authorization != f"Bearer {admin_token}":
                return _err(401, "管理口令不正确")
            username = body.username.strip().lower()
            amount = body.amount
            if amount <= 0:
                return _err(400, "次数需要大于 0")
            with _connect(app.state.db_path) as conn:
                cur = conn.execute(
                    "UPDATE accounts SET enroll_credits = enroll_credits + ? WHERE username = ?",
                    (amount, username),
                )
                if cur.rowcount == 0:
                    return _err(404, "找不到")
            return _ok({"username": username})

    @app.get("/tts/{name}")
    def engine_file(name: str):
        root = Path(app.state.tts_dir) if app.state.tts_dir else None
        if root is None or name not in ENGINE_FILES:
            return _err(404, "没有这个引擎文件")
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            return _err(404, "没有这个引擎文件")
        return FileResponse(path)


_SITE_FILES = {
    "favicon.svg": "image/svg+xml",
    "robots.txt": "text/plain; charset=utf-8",
    "sitemap.xml": "application/xml; charset=utf-8",
    "llms.txt": "text/plain; charset=utf-8",
}


def _site_file(path: Path, media_type: str):
    def send():
        return FileResponse(path, media_type=media_type)

    return send


def _mount_site(app: FastAPI) -> None:
    """官网和安装包。只在配置了目录时挂上，不占用 /v1 与 /tts。"""
    raw = app.state.site_dir
    if not raw:
        return
    root = Path(raw)
    index = root / "index.html"
    if index.is_file():

        @app.get("/")
        def site_index():
            return FileResponse(index, media_type="text/html; charset=utf-8")

    for name, media_type in _SITE_FILES.items():
        path = root / name
        if path.is_file():
            app.add_api_route(
                f"/{name}",
                _site_file(path, media_type),
                methods=["GET"],
                include_in_schema=False,
            )

    download = root / "download"
    if download.is_dir():
        app.mount("/download", StaticFiles(directory=str(download)), name="site-download")


def _issue(app: FastAPI, username: str):
    with _connect(app.state.db_path) as conn:
        account = conn.execute("SELECT id FROM accounts WHERE username = ?", (username,)).fetchone()
        if account is None:
            return _err(401, "用户名或口令不正确")
        now = app.state.clock.now()
        access_jti = uuid.uuid4().hex
        refresh_jti = uuid.uuid4().hex
        access = jwt.encode(
            {"sub": account["id"], "typ": "access", "jti": access_jti, "exp": now + ACCESS_TTL},
            app.state.secret,
            algorithm="HS256",
        )
        refresh = jwt.encode(
            {"sub": account["id"], "typ": "refresh", "jti": refresh_jti, "exp": now + REFRESH_TTL},
            app.state.secret,
            algorithm="HS256",
        )
        conn.execute(
            "INSERT INTO refresh_tokens (jti, account_id, expires_at) VALUES (?, ?, ?)",
            (refresh_jti, account["id"], now + REFRESH_TTL),
        )
    return _ok(
        {
            "accessToken": access,
            "refreshToken": refresh,
            "tokenType": "Bearer",
            "accessExpiresIn": ACCESS_TTL,
            "refreshExpiresIn": REFRESH_TTL,
        }
    )


def _account_from_access(app: FastAPI, authorization: str):
    token = authorization.removeprefix("Bearer ").strip()
    if not token or token == authorization:
        return _err(401, "未登录")
    try:
        payload = jwt.decode(token, app.state.secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return _err(401, "未登录")
    if payload.get("typ") != "access":
        return _err(401, "未登录")
    return _reload(app, str(payload.get("sub", ""))) or _err(401, "未登录")


def _profile(app: FastAPI, account, voice_count: int):
    return {
        "id": account["id"],
        "username": account["username"],
        "enrollCredits": account["enroll_credits"],
        "chargeCredits": app.state.charge_credits,
        "sponsored": int(account["sponsored_at"] or 0) > 0,
        "sponsorChannel": account["sponsor_channel"] or "",
        "voiceCount": voice_count,
        "voiceLimit": VOICE_TOTAL,
    }


def _sponsor_offer():
    return {
        "title": "赞助一杯咖啡",
        "body": "机器和流量是我自己在维护。愿意的话，可以赞助一杯咖啡，帮我把这项基础服务留住。",
        "amountNote": "",
        "note": "",
        "qrs": [
            {"channel": "wechat", "label": "微信", "qrPath": "/v1/sponsor/qrcode/wechat"},
            {"channel": "alipay", "label": "支付宝", "qrPath": "/v1/sponsor/qrcode/alipay"},
        ],
        "voiceLimit": VOICE_TOTAL,
    }


def _voice_count(conn: sqlite3.Connection, account_id: str) -> int:
    row = conn.execute("SELECT COUNT(*) AS n FROM voices WHERE account_id = ?", (account_id,)).fetchone()
    return int(row["n"])


def _reload(app: FastAPI, account_id: str):
    with _connect(app.state.db_path) as conn:
        return conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()


_DUMMY = None


def _dummy_hash() -> str:
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password("unused-password", "000000")
    return _DUMMY


if __name__ == "__main__":
    serve()
