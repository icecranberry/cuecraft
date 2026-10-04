from __future__ import annotations

import hashlib
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.routers import customer_service_router as router_module
from server.utils.auth_middleware import get_db


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router_module.customer_service, prefix="/api")

    async def fake_db():
        return None

    app.dependency_overrides[get_db] = fake_db
    return TestClient(app)


def test_stateless_mcp_initialize_and_chat_follow_json_rpc_contract(monkeypatch):
    token = "test-only-token"
    deployment = SimpleNamespace(
        id="deployment-1",
        public_token_hash=hashlib.sha256(token.encode()).hexdigest(),
        published_modes=["mcp"],
    )
    monkeypatch.setattr(router_module, "public_deployment", lambda **_kwargs: _async_value(deployment))
    monkeypatch.setattr(router_module, "check_public_rate_limit", lambda **_kwargs: _async_value(None))
    monkeypatch.setattr(
        router_module,
        "run_public_customer_message",
        lambda **_kwargs: _async_value({"answer": "请告诉我您关注的球杆规格。"}),
    )
    client = _client()
    headers = {"Authorization": f"Bearer {token}"}

    initialized = client.post(
        "/api/customer-service/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}},
    )
    assert initialized.status_code == 200
    assert initialized.headers["MCP-Protocol-Version"] == "2025-11-25"
    assert initialized.json()["result"]["protocolVersion"] == "2025-11-25"

    listed = client.post(
        "/api/customer-service/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    )
    assert listed.status_code == 200
    assert listed.json()["result"]["tools"][0]["name"] == "customer_service_chat"

    called = client.post(
        "/api/customer-service/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "customer_service_chat",
                "arguments": {"message": "球杆有几种材质？", "session_id": "s-1", "idempotency_key": "r-1"},
            },
        },
    )
    assert called.status_code == 200
    assert called.json()["result"]["content"][0]["text"] == "请告诉我您关注的球杆规格。"


def test_mcp_initialize_handles_invalid_params_and_wrong_credentials(monkeypatch):
    token = "test-only-token"
    deployment = SimpleNamespace(
        id="deployment-1",
        public_token_hash=hashlib.sha256(token.encode()).hexdigest(),
        published_modes=["mcp"],
    )
    monkeypatch.setattr(router_module, "public_deployment", lambda **_kwargs: _async_value(deployment))
    client = _client()

    response = client.post(
        "/api/customer-service/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": "invalid"},
    )
    assert response.status_code == 200
    assert response.json()["result"]["protocolVersion"] == router_module.MCP_PROTOCOL_VERSION

    denied = client.post(
        "/api/customer-service/mcp",
        headers={"Authorization": "Bearer wrong-token"},
        json={"jsonrpc": "2.0", "id": 2, "method": "ping"},
    )
    assert denied.status_code == 401


def test_embed_document_escapes_title_and_sets_frame_ancestors(monkeypatch):
    deployment = SimpleNamespace(
        id="deployment-1",
        name='"<script>alert(1)</script>',
        published_modes=["iframe"],
        published_iframe_origins=["https://shop.example.com"],
    )
    monkeypatch.setattr(router_module, "public_deployment", lambda **_kwargs: _async_value(deployment))

    response = _client().get("/api/customer-service/embed/public-token")

    assert response.status_code == 200
    assert response.headers["content-security-policy"] == "frame-ancestors 'self' https://shop.example.com"
    assert "&quot;&lt;script&gt;alert(1)&lt;/script&gt;" in response.text
    assert "<title><script>" not in response.text


def test_webhook_sends_authenticated_message_to_published_deployment(monkeypatch):
    token = "test-only-webhook-token"
    deployment = SimpleNamespace(
        id="deployment-1",
        public_token_hash=hashlib.sha256(token.encode()).hexdigest(),
        published_modes=["webhook"],
    )
    calls = []

    async def run_message(**kwargs):
        calls.append(kwargs)
        return {"answer": "我们有多种杆体材质。"}

    monkeypatch.setattr(router_module, "public_deployment", lambda **_kwargs: _async_value(deployment))
    monkeypatch.setattr(router_module, "check_public_rate_limit", lambda **_kwargs: _async_value(None))
    monkeypatch.setattr(router_module, "run_public_customer_message", run_message)

    response = _client().post(
        "/api/customer-service/webhook",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": "有哪些材质？", "session_id": "session-1", "idempotency_key": "request-1"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["answer"] == "我们有多种杆体材质。"
    assert calls[0]["channel"] == "webhook"
    assert calls[0]["idempotency_key"] == "request-1"


async def _async_value(value):
    return value
