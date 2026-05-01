"""Database-backed authentication utilities."""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from typing import Optional

from fastapi import Cookie, HTTPException


SESSION_COOKIE_NAME = "water_twin_session"
DB_PATH = os.getenv("WATER_TWIN_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "auth.db"))
DB_PATH = os.path.abspath(DB_PATH)
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
ACCOUNT_LOCK_THRESHOLD = 5
ACCOUNT_LOCK_SECONDS = 600


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]) == column for row in rows)


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
        if not _has_column(conn, "users", "failed_attempts"):
            conn.execute("ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0")
        if not _has_column(conn, "users", "locked_until"):
            conn.execute("ALTER TABLE users ADD COLUMN locked_until TEXT")
        if not _has_column(conn, "users", "last_login_at"):
            conn.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT")
        if not _has_column(conn, "users", "last_login_ip"):
            conn.execute("ALTER TABLE users ADD COLUMN last_login_ip TEXT")
        if not _has_column(conn, "users", "last_login_user_agent"):
            conn.execute("ALTER TABLE users ADD COLUMN last_login_user_agent TEXT")
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                event_type TEXT NOT NULL,
                success INTEGER NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                detail TEXT,
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


def validate_username(username: str) -> str | None:
    if not USERNAME_PATTERN.fullmatch(username or ""):
        return "用户名需为 3-32 位，可包含字母、数字、下划线、点和短横线"
    return None


def validate_password_strength(password: str) -> str | None:
    if not password or len(password) < 8 or len(password) > 64:
        return "密码需为 8-64 位"
    if not re.search(r"[A-Za-z]", password):
        return "密码至少包含一个字母"
    if not re.search(r"\d", password):
        return "密码至少包含一个数字"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "密码至少包含一个特殊字符"
    return None


def mask_ip(value: str | None) -> str:
    if not value:
        return "-"
    try:
        parsed = ip_address(value)
    except ValueError:
        return value
    if parsed.version == 4:
        parts = value.split(".")
        return ".".join(parts[:2] + ["*", "*"])
    segments = value.split(":")
    return ":".join(segments[:2] + ["*", "*"])


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


def remove_user_sessions(username: str, keep_token: Optional[str] = None) -> None:
    with _get_conn() as conn:
        if keep_token:
            conn.execute("DELETE FROM sessions WHERE username = ? AND token != ?", (username, keep_token))
        else:
            conn.execute("DELETE FROM sessions WHERE username = ?", (username,))
        conn.commit()


def is_user_locked(row: sqlite3.Row | None) -> tuple[bool, str | None]:
    if not row:
        return False, None
    locked_until = row["locked_until"] if "locked_until" in row.keys() else None
    if not locked_until:
        return False, None
    try:
        expires_at = datetime.fromisoformat(str(locked_until))
    except ValueError:
        return False, None
    if expires_at <= _utc_now():
        unlock_user(str(row["username"]))
        return False, None
    return True, expires_at.isoformat()


def register_failed_login(username: str) -> tuple[int, str | None]:
    row = get_user(username)
    if not row:
        return 0, None
    attempts = int(row["failed_attempts"] or 0) + 1
    locked_until = None
    if attempts >= ACCOUNT_LOCK_THRESHOLD:
        locked_until = (_utc_now() + timedelta(seconds=ACCOUNT_LOCK_SECONDS)).isoformat()
    with _get_conn() as conn:
        conn.execute(
            "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE username = ?",
            (0 if locked_until else attempts, locked_until, _utc_now().isoformat(), username),
        )
        conn.commit()
    return attempts, locked_until


def reset_login_failures(username: str, ip: str | None = None, user_agent: str | None = None) -> None:
    now = _utc_now().isoformat()
    with _get_conn() as conn:
        conn.execute(
            """
            UPDATE users
            SET failed_attempts = 0,
                locked_until = NULL,
                last_login_at = ?,
                last_login_ip = ?,
                last_login_user_agent = ?,
                updated_at = ?
            WHERE username = ?
            """,
            (now, ip, user_agent, now, username),
        )
        conn.commit()


def unlock_user(username: str) -> None:
    with _get_conn() as conn:
        conn.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE username = ?",
            (_utc_now().isoformat(), username),
        )
        conn.commit()


def log_auth_event(
    username: str,
    event_type: str,
    success: bool,
    ip: str | None = None,
    user_agent: str | None = None,
    detail: str | None = None,
) -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO auth_logs (username, event_type, success, ip_address, user_agent, detail, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (username or "anonymous", event_type, 1 if success else 0, ip, user_agent, detail, _utc_now().isoformat()),
        )
        conn.commit()


def get_recent_auth_logs(username: str, limit: int = 20) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT event_type, success, ip_address, user_agent, detail, created_at
            FROM auth_logs
            WHERE username = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (username, limit),
        ).fetchall()
    return [
        {
            "event_type": str(row["event_type"]),
            "success": bool(row["success"]),
            "ip_address": mask_ip(row["ip_address"]),
            "detail": row["detail"] or "",
            "user_agent": row["user_agent"] or "",
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_security_overview(username: str) -> dict:
    row = get_user(username)
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在")
    locked, locked_until = is_user_locked(row)
    return {
        "username": username,
        "failed_attempts": int(row["failed_attempts"] or 0),
        "is_locked": locked,
        "locked_until": locked_until,
        "last_login_at": row["last_login_at"],
        "last_login_ip": mask_ip(row["last_login_ip"]),
        "recent_logs": get_recent_auth_logs(username),
    }


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
