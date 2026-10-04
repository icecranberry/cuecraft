from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from yuxi.storage.postgres.manager import pg_manager
from yuxi.storage.postgres.models_business import Agent, CustomerServiceDeployment

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def _remove_deployment(deployment_id: str) -> None:
    """清理测试创建的部署和隐藏 Agent 快照。"""
    pg_manager.initialize()
    try:
        async with pg_manager.get_async_session_context() as db:
            deployment = await db.get(CustomerServiceDeployment, deployment_id)
            if deployment is not None:
                if deployment.published_agent_slug:
                    await db.execute(delete(Agent).where(Agent.slug == deployment.published_agent_slug))
                await db.delete(deployment)
                await db.commit()
    finally:
        await pg_manager.close()


async def test_customer_service_publish_share_embed_mcp_rotate_and_revoke(
    test_client,
    standard_user,
    admin_headers,
):
    """真实 HTTP 发布固定 Agent 快照，并验证匿名入口及凭据撤销。"""
    headers = standard_user["headers"]
    deployment_id = None
    try:
        agents_response = await test_client.get("/api/customer-service/agents", headers=headers)
        assert agents_response.status_code == 200, agents_response.text
        agent = next((item for item in agents_response.json() if item["slug"] == "default-chatbot"), None)
        assert agent is not None

        created = await test_client.post(
            "/api/customer-service/deployments",
            headers=headers,
            json={"name": f"pytest-customer-service-{uuid.uuid4().hex[:10]}", "agent_slug": agent["slug"]},
        )
        assert created.status_code == 200, created.text
        deployment_id = created.json()["id"]

        saved = await test_client.put(
            f"/api/customer-service/deployments/{deployment_id}",
            headers=headers,
            json={
                "name": created.json()["name"],
                "agent_slug": agent["slug"],
                "modes": ["share", "iframe", "webhook", "mcp"],
                "iframe_origins": ["https://shop.example.com"],
            },
        )
        assert saved.status_code == 200, saved.text

        published = await test_client.post(
            f"/api/customer-service/deployments/{deployment_id}/publish",
            headers=headers,
            json={},
        )
        assert published.status_code == 200, published.text
        token = published.json()["public_token"]
        snapshot_slug = published.json()["deployment"]["published_agent_slug"]
        assert token and snapshot_slug != agent["slug"]

        owner_records = await test_client.get("/api/customer-service/deployments", headers=headers)
        assert owner_records.status_code == 200, owner_records.text
        assert deployment_id in {item["id"] for item in owner_records.json()}
        other_records = await test_client.get("/api/customer-service/deployments", headers=admin_headers)
        assert other_records.status_code == 200, other_records.text
        assert deployment_id not in {item["id"] for item in other_records.json()}

        info = await test_client.get(f"/api/customer-service/public/{token}?mode=share")
        assert info.status_code == 200, info.text
        assert info.json()["name"] == created.json()["name"]

        embed = await test_client.get(f"/api/customer-service/embed/{token}")
        assert embed.status_code == 200, embed.text
        assert embed.headers["content-security-policy"] == "frame-ancestors 'self' https://shop.example.com"

        mcp = await test_client.post(
            "/api/customer-service/mcp",
            headers={"Authorization": f"Bearer {token}", "MCP-Protocol-Version": "2025-11-25"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        assert mcp.status_code == 200, mcp.text
        assert mcp.json()["result"]["tools"][0]["name"] == "customer_service_chat"

        rotated = await test_client.post(
            f"/api/customer-service/deployments/{deployment_id}/rotate-token",
            headers=headers,
            json={},
        )
        assert rotated.status_code == 200, rotated.text
        new_token = rotated.json()["public_token"]
        assert (await test_client.get(f"/api/customer-service/public/{token}")).status_code == 404
        assert (await test_client.get(f"/api/customer-service/public/{new_token}")).status_code == 200

        revoked = await test_client.post(
            f"/api/customer-service/deployments/{deployment_id}/revoke",
            headers=headers,
            json={},
        )
        assert revoked.status_code == 200, revoked.text
        assert (await test_client.get(f"/api/customer-service/public/{new_token}")).status_code == 404
    finally:
        if deployment_id:
            await _remove_deployment(deployment_id)
