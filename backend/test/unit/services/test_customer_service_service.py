from __future__ import annotations

import hashlib

import pytest
from fastapi import HTTPException

from yuxi.services.customer_service_service import (
    normalize_iframe_origins,
    validate_deployment_modes,
    verify_bearer_token,
)


def test_iframe_origins_are_normalized_and_exact():
    assert normalize_iframe_origins(["https://Shop.example.com/", "https://shop.example.com"]) == [
        "https://shop.example.com"
    ]


@pytest.mark.parametrize(
    "origin",
    ["https://shop.example.com/path", "https://user:password@shop.example.com", "https://shop.example.com:bad"],
)
def test_iframe_origins_reject_path_credentials_and_invalid_ports(origin: str):
    with pytest.raises(HTTPException) as caught:
        normalize_iframe_origins([origin])

    assert caught.value.status_code == 422


def test_iframe_mode_requires_an_origin_allowlist():
    with pytest.raises(HTTPException) as caught:
        validate_deployment_modes(["share", "iframe"], [])

    assert caught.value.status_code == 422


def test_unknown_deployment_mode_is_rejected():
    with pytest.raises(HTTPException) as caught:
        validate_deployment_modes(["share", "unknown"], [])

    assert caught.value.status_code == 422


def test_bearer_verification_rejects_wrong_and_missing_tokens():
    expected = hashlib.sha256(b"secret-token").hexdigest()

    assert verify_bearer_token("Bearer secret-token", expected)
    assert not verify_bearer_token("Bearer other-token", expected)
    assert not verify_bearer_token(None, expected)
