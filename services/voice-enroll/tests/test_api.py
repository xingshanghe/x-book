from __future__ import annotations

import base64
import io
import wave
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import Clock, create_app


def wav_bytes(seconds: float, rate: int = 24000, amplitude: int = 4000, gap_at: float | None = None) -> bytes:
    frames = bytearray()
    total = int(seconds * rate)
    gap_start = int((gap_at or -1) * rate)
    gap_end = gap_start + rate if gap_at is not None else -1
    for index in range(total):
        sample = 0 if gap_start <= index < gap_end else amplitude
        frames += int(sample).to_bytes(2, "little", signed=True)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(frames)
    return buf.getvalue()


def build(tmp_path: Path, admin: str | None = "admin-secret"):
    clock = Clock()
    app = create_app(str(tmp_path / "enroll.db"), "test-secret", admin, clock, str(tmp_path / "uploads"))
    return TestClient(app), clock, tmp_path / "uploads"


def sponsor(client: TestClient, token: str, channel: str = "wechat"):
    return client.post(
        "/v1/account/sponsor",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": channel},
    )


def enroll(client: TestClient, token: str, amplitude: int = 4000):
    return client.post(
        "/v1/voices/enroll",
        headers={"Authorization": f"Bearer {token}"},
        files={"audio": ("a.wav", wav_bytes(6, amplitude=amplitude), "audio/wav")},
        data={"transcript": "今天把这一小段念完。", "consent": "true"},
    )


def test_login_preflight_is_allowed(tmp_path: Path):
    client, _, _ = build(tmp_path)
    response = client.options(
        "/v1/auth/login",
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


def test_default_clock_follows_wall_time(tmp_path: Path, monkeypatch):
    ticks = {"n": 1_700_000_000}

    def fake_time():
        ticks["n"] += 10
        return ticks["n"]

    monkeypatch.setattr("app.main.time.time", fake_time)
    app = create_app(str(tmp_path / "enroll.db"), "test-secret")
    first = app.state.clock.now()
    second = app.state.clock.now()
    assert second == first + 10


def test_register_login_and_duplicate(tmp_path: Path):
    client, _, _ = build(tmp_path)
    created = client.post("/v1/auth/register", json={"username": "Reader_1", "password": "password1"})
    assert created.status_code == 200
    assert created.json()["data"]["accessToken"]
    assert "password_hash" not in created.text
    again = client.post("/v1/auth/register", json={"username": "reader_1", "password": "password1"})
    assert again.status_code == 409
    short = client.post("/v1/auth/register", json={"username": "ab", "password": "short"})
    assert short.status_code == 400


def test_unknown_user_and_bad_password_share_a_message(tmp_path: Path):
    client, _, _ = build(tmp_path)
    client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    missing = client.post("/v1/auth/login", json={"username": "nobody", "password": "password1"})
    wrong = client.post("/v1/auth/login", json={"username": "reader", "password": "nope-nope"})
    assert missing.status_code == 401
    assert missing.json()["message"] == wrong.json()["message"]


def test_lockout_and_refresh_rotation(tmp_path: Path):
    client, clock, _ = build(tmp_path)
    client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    for _ in range(5):
        assert client.post("/v1/auth/login", json={"username": "reader", "password": "nope-nope"}).status_code == 401
    locked = client.post("/v1/auth/login", json={"username": "reader", "password": "password1"})
    assert locked.status_code == 423
    clock.advance(15 * 60)
    opened = client.post("/v1/auth/login", json={"username": "reader", "password": "password1"})
    assert opened.status_code == 200
    refresh = opened.json()["data"]["refreshToken"]
    rotated = client.post("/v1/auth/refresh", json={"refreshToken": refresh})
    assert rotated.status_code == 200
    assert rotated.json()["data"]["refreshToken"] != refresh
    client.post("/v1/auth/logout", json={"refreshToken": rotated.json()["data"]["refreshToken"]})
    denied = client.post("/v1/auth/refresh", json={"refreshToken": rotated.json()["data"]["refreshToken"]})
    assert denied.status_code == 401


def test_enroll_skips_credits_when_charging_is_off(tmp_path: Path):
    clock = Clock()
    app = create_app(
        str(tmp_path / "enroll.db"),
        "test-secret",
        None,
        clock,
        str(tmp_path / "uploads"),
        charge_credits=False,
    )
    client = TestClient(app)
    health = client.get("/v1/health")
    assert health.json()["data"]["chargeCredits"] is False
    created = client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    token = created.json()["data"]["accessToken"]
    made = enroll(client, token)
    assert made.status_code == 200
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["enrollCredits"] == 0
    assert me.json()["data"]["chargeCredits"] is False
    assert me.json()["data"]["sponsored"] is False
    assert me.json()["data"]["voiceCount"] == 1
    assert list((tmp_path / "uploads").iterdir()) == []


def test_sponsor_once_then_keep_three_voices(tmp_path: Path):
    client, _, uploads = build(tmp_path)
    client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    other = client.post("/v1/auth/register", json={"username": "other", "password": "password1"})
    other_token = other.json()["data"]["accessToken"]
    signed = client.post("/v1/auth/login", json={"username": "reader", "password": "password1"})
    token = signed.json()["data"]["accessToken"]
    offer = client.get("/v1/sponsor")
    assert offer.status_code == 200
    assert "咖啡" in offer.json()["data"]["title"]
    assert "9.9" not in offer.json()["data"]["amountNote"]
    assert offer.json()["data"]["voiceLimit"] == 3
    qrs = offer.json()["data"]["qrs"]
    assert [item["channel"] for item in qrs] == ["wechat", "alipay"]
    for item in qrs:
        qr = client.get(item["qrPath"])
        assert qr.status_code == 200
        assert qr.content.startswith(b"\x89PNG")

    assert client.post("/v1/account/sponsor", json={"channel": "wechat"}).status_code == 401

    added = client.post(
        "/v1/admin/credits",
        headers={"Authorization": "Bearer admin-secret"},
        json={"username": "reader", "amount": 1},
    )
    assert added.status_code == 200
    bad_admin = client.post(
        "/v1/admin/credits",
        headers={"Authorization": "Bearer nope"},
        json={"username": "reader", "amount": 1},
    )
    assert bad_admin.status_code == 401

    assert client.post(
        "/v1/account/sponsor",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": "cash"},
    ).status_code == 400
    assert sponsor(client, token, "alipay").status_code == 200
    assert sponsor(client, token, "wechat").status_code == 200
    assert client.get("/v1/sponsor/thanks").status_code == 404
    made = enroll(client, token)
    assert made.status_code == 200
    assert list(uploads.iterdir()) == []
    voice_id = made.json()["data"]["id"]
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["enrollCredits"] == 1
    assert me.json()["data"]["sponsored"] is True
    assert me.json()["data"]["sponsorChannel"] == "alipay"
    assert me.json()["data"]["voiceCount"] == 1
    hidden = client.delete(f"/v1/voices/{voice_id}", headers={"Authorization": f"Bearer {other_token}"})
    assert hidden.status_code == 404
    own = client.get("/v1/voices", headers={"Authorization": f"Bearer {other_token}"})
    assert own.json()["data"] == []
    restored = client.get("/v1/voices", headers={"Authorization": f"Bearer {token}"})
    assert restored.json()["data"][0]["id"] == voice_id
    assert base64.b64decode(restored.json()["data"][0]["wavBase64"]).startswith(b"RIFF")
    before = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["data"]["enrollCredits"]
    noisy = enroll(client, token, amplitude=32767)
    assert noisy.json()["message"] == "太吵"
    after = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["data"]["enrollCredits"]
    assert after == before

    second = enroll(client, token)
    assert second.status_code == 200
    full = enroll(client, token)
    assert full.status_code == 409
    assert full.json()["message"] == "最多保留 3 个音色（含引擎示例），请先删掉一个"
    removed = client.delete(
        f"/v1/voices/{second.json()['data']['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert removed.status_code == 200
    again = enroll(client, token)
    assert again.status_code == 200
    counted = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert counted.json()["data"]["voiceCount"] == 2
    assert counted.json()["data"]["voiceLimit"] == 3


def test_sponsor_record_keeps_name_phone_date_and_note(tmp_path: Path):
    client, _, _ = build(tmp_path)
    created = client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    token = created.json()["data"]["accessToken"]
    anonymous = client.post(
        "/v1/sponsor/records",
        json={"name": "reader", "phone": "13800138000", "paidOn": "2026-10-26", "note": ""},
    )
    assert anonymous.status_code == 401
    missing = client.post(
        "/v1/sponsor/records",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "", "phone": "13800138000", "paidOn": "2026-10-26", "note": ""},
    )
    assert missing.status_code == 400
    bad_phone = client.post(
        "/v1/sponsor/records",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "reader", "phone": "123", "paidOn": "2026-10-26", "note": ""},
    )
    assert bad_phone.status_code == 400
    saved = client.post(
        "/v1/sponsor/records",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "大炮", "phone": "13800138000", "paidOn": "2026-10-26", "note": "微信"},
    )
    assert saved.status_code == 200
    assert saved.json()["data"]["id"]
    assert client.get("/v1/sponsor/thanks").status_code == 404


def test_change_password_revokes_refresh_tokens(tmp_path: Path):
    client, _, _ = build(tmp_path)
    created = client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    access = created.json()["data"]["accessToken"]
    refresh = created.json()["data"]["refreshToken"]
    client.post(
        "/v1/admin/credits",
        headers={"Authorization": "Bearer admin-secret"},
        json={"username": "reader", "amount": 1},
    )
    wrong = client.post(
        "/v1/auth/password",
        headers={"Authorization": f"Bearer {access}"},
        json={"oldPassword": "nope-pass", "newPassword": "password2"},
    )
    assert wrong.status_code == 401
    assert wrong.json()["message"] == "原口令不正确"
    short = client.post(
        "/v1/auth/password",
        headers={"Authorization": f"Bearer {access}"},
        json={"oldPassword": "password1", "newPassword": "short"},
    )
    assert short.status_code == 400
    changed = client.post(
        "/v1/auth/password",
        headers={"Authorization": f"Bearer {access}"},
        json={"oldPassword": "password1", "newPassword": "password2"},
    )
    assert changed.status_code == 200
    new_access = changed.json()["data"]["accessToken"]
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.json()["data"]["enrollCredits"] == 1
    assert client.post("/v1/auth/refresh", json={"refreshToken": refresh}).status_code == 401
    assert client.post("/v1/auth/login", json={"username": "reader", "password": "password1"}).status_code == 401
    relogin = client.post("/v1/auth/login", json={"username": "reader", "password": "password2"})
    assert relogin.status_code == 200
    missing = client.post(
        "/v1/auth/password",
        json={"oldPassword": "password2", "newPassword": "password3"},
    )
    assert missing.status_code == 401


def test_engine_file_can_be_fetched_in_ranges(tmp_path: Path):
    engine = tmp_path / "tts"
    engine.mkdir()
    name = "vocos_24khz.onnx"
    (engine / name).write_bytes(b"abcdef")
    app = create_app(
        str(tmp_path / "enroll.db"),
        "test-secret",
        None,
        Clock(),
        str(tmp_path / "uploads"),
        str(engine),
    )
    client = TestClient(app)
    whole = client.get(f"/tts/{name}")
    assert whole.status_code == 200
    assert whole.content == b"abcdef"
    partial = client.get(f"/tts/{name}", headers={"Range": "bytes=1-2"})
    assert partial.status_code == 206
    assert partial.content == b"bc"
    assert client.get("/tts/other.bin").status_code == 404


def test_no_synthesis_route(tmp_path: Path):
    client, _, _ = build(tmp_path, admin=None)
    paths = {getattr(route, "path", "") for route in client.app.routes}
    assert "/v1/tts/stream" not in paths
    assert "/v1/tts/synth" not in paths
    assert "/v1/admin/credits" not in paths
    assert client.get("/v1/voices").status_code == 401
