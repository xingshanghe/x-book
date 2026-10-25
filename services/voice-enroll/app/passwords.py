from __future__ import annotations

import secrets

import bcrypt

def generate_salt() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_password(password: str, salt: str) -> str:
    material = (password + salt).encode()
    return bcrypt.hashpw(material, bcrypt.gensalt()).decode()


def verify_password(password_hash: str, password: str, salt: str) -> bool:
    material = (password + salt).encode()
    return bcrypt.checkpw(material, password_hash.encode())
