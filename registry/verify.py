"""Gist-based wallet verification.

Registration flow:
1. Contributor signs message with their wallet: "I am {github_username} on ContribChain"
2. Contributor publishes the signature as a GitHub gist
3. This module verifies: signature matches claimed wallet, gist belongs to claimed user
"""

from __future__ import annotations

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct


def build_message(github_username: str) -> str:
    """Build the canonical message a contributor must sign."""
    return f"I am {github_username} on ContribChain"


def verify_signature(
    github_username: str,
    wallet_address: str,
    signature: str,
) -> bool:
    """Verify that the signature was produced by the claimed wallet.

    Args:
        github_username: The GitHub username being claimed.
        wallet_address: The wallet address being claimed (checksummed or lowercase).
        signature: Hex-encoded signature of the canonical message.

    Returns:
        True if the recovered address matches the claimed wallet.
    """
    message = build_message(github_username)
    msg = encode_defunct(text=message)
    recovered = Account.recover_message(msg, signature=signature)
    return recovered.lower() == wallet_address.lower()


def verify_gist(
    github_username: str,
    gist_url: str,
    expected_signature: str,
) -> bool:
    """Verify that a public gist belongs to the claimed user and contains the signature.

    Args:
        github_username: The GitHub username that should own the gist.
        gist_url: Public gist URL (e.g., https://gist.github.com/user/abc123).
        expected_signature: The signature that should appear in the gist content.

    Returns:
        True if gist is owned by the user and contains the signature.
    """
    # Extract gist ID from URL
    gist_id = gist_url.rstrip("/").split("/")[-1]
    api_url = f"https://api.github.com/gists/{gist_id}"

    resp = httpx.get(api_url, headers={"Accept": "application/vnd.github.v3+json"})
    if resp.status_code != 200:
        return False

    data = resp.json()

    # Verify gist owner matches claimed username
    owner = data.get("owner", {}).get("login", "")
    if owner.lower() != github_username.lower():
        return False

    # Verify gist contains the expected signature
    for file_info in data.get("files", {}).values():
        content = file_info.get("content", "")
        if expected_signature in content:
            return True

    return False


def full_verification(
    github_username: str,
    wallet_address: str,
    signature: str,
    gist_url: str,
) -> tuple[bool, str]:
    """Run complete verification: signature check + gist ownership.

    Returns:
        (success, error_message) tuple.
    """
    if not verify_signature(github_username, wallet_address, signature):
        return False, "Signature does not match claimed wallet address"

    if not verify_gist(github_username, gist_url, signature):
        return False, "Gist not found, not owned by user, or missing signature"

    return True, ""
