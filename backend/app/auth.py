"""Database-backed authentication utilities."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, HTTPException


SESSION_COOKIE_NAME = "water_twin_session"
DB_PATH = os.getenv("WATER_TWIN_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "auth.db"))
DB_PATH = os.path.abspath(DB_PATH)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_auth_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()

    ensure_default_admin()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"{salt}${digest.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, expected = stored_hash.split("$", 1)
    except ValueError:
        return False
    actual = _hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(actual, expected)


def ensure_default_admin() -> None:
    default_username = os.getenv("WATER_TWIN_USERNAME", "admin")
    default_password = os.getenv("WATER_TWIN_PASSWORD", "admin123")
    if get_user(default_username):
        return
    create_user(default_username, default_password)


def get_user(username: str) -> sqlite3.Row | None:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return row


def create_user(username: str, password: str) -> None:
    now = _utc_now().isoformat()
    password_hash = _hash_password(password)
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, now, now),
        )
        conn.commit()


def update_password(username: str, new_password: str) -> None:
    now = _utc_now().isoformat()
    password_hash = _hash_password(new_password)
    with _get_conn() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?",
            (password_hash, now, username),
        )
        conn.commit()


def verify_credentials(username: str, password: str) -> bool:
    row = get_user(username)
    if not row:
        return False
    return _verify_password(password, row["password_hash"])


def create_session(username: str, remember_me: bool = False) -> tuple[str, int]:
    token = secrets.token_urlsafe(32)
    ttl_seconds = 60 * 60 * 24 * 7 if remember_me else 60 * 60 * 12
    now = _utc_now()
    expires_at = now + timedelta(seconds=ttl_seconds)
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, username, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, username, expires_at.isoformat(), now.isoformat()),
        )
        conn.commit()
    return token, ttl_seconds


def remove_session(token: Optional[str]) -> None:
    if not token:
        return
    with _get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def get_current_user(session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME)) -> str:
    if not session_token:
        raise HTTPException(status_code=401, detail="未登录")

    with _get_conn() as conn:
        row = conn.execute("SELECT username, expires_at FROM sessions WHERE token = ?", (session_token,)).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="登录状态已失效")

        expires_at = datetime.fromisoformat(row["expires_at"])
        if expires_at <= _utc_now():
            conn.execute("DELETE FROM sessions WHERE token = ?", (session_token,))
            conn.commit()
            raise HTTPException(status_code=401, detail="登录状态已过期")

        return str(row["username"])
