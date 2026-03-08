"""ContribRegistry — GitHub username to wallet mapping with gist-based verification."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from models import get_db, get_wallet, register_contributor
from verify import full_verification


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize DB on startup."""
    app.state.db = get_db()
    yield
    app.state.db.close()


app = FastAPI(
    title="ContribRegistry",
    description="GitHub username → wallet mapping with gist-based verification",
    version="0.1.0",
    lifespan=lifespan,
)


class RegisterRequest(BaseModel):
    github_username: str
    wallet_address: str
    signature: str
    gist_url: str


class WalletResponse(BaseModel):
    wallet: str


@app.get("/wallet/{github_username}", response_model=WalletResponse)
async def lookup_wallet(github_username: str) -> WalletResponse:
    """Look up the wallet address for a GitHub username."""
    wallet = get_wallet(app.state.db, github_username)
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not registered")
    return WalletResponse(wallet=wallet)


@app.post("/register", status_code=201)
async def register(req: RegisterRequest) -> dict[str, str]:
    """Register a GitHub username → wallet mapping.

    Requires:
    1. A valid signature of "I am {username} on ContribChain" by the claimed wallet.
    2. A public GitHub gist owned by the user containing the signature.
    """
    ok, err = full_verification(
        req.github_username,
        req.wallet_address,
        req.signature,
        req.gist_url,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    try:
        register_contributor(
            app.state.db,
            req.github_username,
            req.wallet_address,
            req.gist_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    return {"status": "registered", "username": req.github_username}


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check."""
    return {"status": "ok"}
