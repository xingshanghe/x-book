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
    made = client.post(
        "/v1/voices/enroll",
        headers={"Authorization": f"Bearer {token}"},
        files={"audio": ("a.wav", wav_bytes(6), "audio/wav")},
        data={"transcript": "今天把这一小段念完。", "consent": "true"},
    )
    assert made.status_code == 200
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["enrollCredits"] == 0
    assert me.json()["data"]["chargeCredits"] is False
    assert list((tmp_path / "uploads").iterdir()) == []


def test_enroll_debits_credits_and_hides_other_accounts(tmp_path: Path):
    client, _, uploads = build(tmp_path)
    client.post("/v1/auth/register", json={"username": "reader", "password": "password1"})
    other = client.post("/v1/auth/register", json={"username": "other", "password": "password1"})
    other_token = other.json()["data"]["accessToken"]
    no_credit = client.post("/v1/auth/login", json={"username": "reader", "password": "password1"})
    token = no_credit.json()["data"]["accessToken"]
    empty = client.post(
        "/v1/voices/enroll",
        headers={"Authorization": f"Bearer {token}"},
        files={"audio": ("a.wav", wav_bytes(6), "audio/wav")},
        data={"transcript": "今天把这一小段念完。", "consent": "true"},
    )
    assert empty.status_code == 402
    assert list(uploads.iterdir()) == []

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

    made = client.post(
        "/v1/voices/enroll",
        headers={"Authorization": f"Bearer {token}"},
        files={"audio": ("a.wav", wav_bytes(6), "audio/wav")},
        data={"transcript": "今天把这一小段念完。", "consent": "true"},
    )
    assert made.status_code == 200
    assert list(uploads.iterdir()) == []
    voice_id = made.json()["data"]["id"]
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["enrollCredits"] == 0
    hidden = client.delete(f"/v1/voices/{voice_id}", headers={"Authorization": f"Bearer {other_token}"})
    assert hidden.status_code == 404
    own = client.get("/v1/voices", headers={"Authorization": f"Bearer {other_token}"})
    assert own.json()["data"] == []
    restored = client.get("/v1/voices", headers={"Authorization": f"Bearer {token}"})
    assert restored.json()["data"][0]["id"] == voice_id
    assert base64.b64decode(restored.json()["data"][0]["wavBase64"]).startswith(b"RIFF")
    client.post(
        "/v1/admin/credits",
        headers={"Authorization": "Bearer admin-secret"},
        json={"username": "reader", "amount": 1},
    )
    before = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["data"]["enrollCredits"]
    noisy = client.post(
        "/v1/voices/enroll",
        headers={"Authorization": f"Bearer {token}"},
        files={"audio": ("a.wav", wav_bytes(6, amplitude=32767), "audio/wav")},
        data={"transcript": "今天把这一小段念完。", "consent": "true"},
    )
    assert noisy.json()["message"] == "太吵"
    after = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["data"]["enrollCredits"]
    assert after == before


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
