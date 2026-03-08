"""Registry data models."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "registry.db"
ROTATION_COOLDOWN_DAYS = 7


def get_db() -> sqlite3.Connection:
    """Return a SQLite connection with WAL mode."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contributors (
            github_username TEXT PRIMARY KEY,
            wallet_address  TEXT NOT NULL,
            gist_url        TEXT NOT NULL,
            registered_at   REAL NOT NULL,
            last_rotated_at REAL
        )
    """)
    conn.commit()
    return conn


def register_contributor(
    conn: sqlite3.Connection,
    github_username: str,
    wallet_address: str,
    gist_url: str,
) -> None:
    """Register or update a contributor mapping."""
    now = time.time()

    existing = conn.execute(
        "SELECT last_rotated_at FROM contributors WHERE github_username = ?",
        (github_username,),
    ).fetchone()

    if existing and existing[0]:
        elapsed_days = (now - existing[0]) / 86400
        if elapsed_days < ROTATION_COOLDOWN_DAYS:
            remaining = ROTATION_COOLDOWN_DAYS - elapsed_days
            raise ValueError(
                f"Wallet rotation cooldown: {remaining:.1f} days remaining"
            )

    conn.execute(
        """INSERT INTO contributors (github_username, wallet_address, gist_url, registered_at, last_rotated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(github_username) DO UPDATE SET
               wallet_address = excluded.wallet_address,
               gist_url = excluded.gist_url,
               last_rotated_at = excluded.registered_at
        """,
        (github_username, wallet_address.lower(), gist_url, now, now),
    )
    conn.commit()


def get_wallet(conn: sqlite3.Connection, github_username: str) -> str | None:
    """Look up wallet address for a GitHub username."""
    row = conn.execute(
        "SELECT wallet_address FROM contributors WHERE github_username = ?",
        (github_username,),
    ).fetchone()
    return row[0] if row else None
