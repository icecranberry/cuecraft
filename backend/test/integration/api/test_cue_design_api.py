from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def test_save_design_accepts_bundled_pattern_and_rejects_unknown_asset(test_client, admin_headers):
    design_id = None
    try:
        created = await test_client.post(
            "/api/cue/designs",
            headers=admin_headers,
            json={
                "name": f"Pytest bundled pattern {uuid.uuid4().hex[:8]}",
                "snapshot": {
                    "partOverrides": {},
                    "stickers": [{"assetId": "builtin-jade-spear"}],
                },
            },
        )
        assert created.status_code == 200, created.text
        design_id = created.json()["id"]
        assert created.json()["version"] == 1

        persisted = await test_client.get(f"/api/cue/designs/{design_id}", headers=admin_headers)
        assert persisted.status_code == 200, persisted.text
        assert persisted.json()["snapshot"]["stickers"][0]["assetId"] == "builtin-jade-spear"

        rejected = await test_client.post(
            "/api/cue/designs",
            headers=admin_headers,
            json={
                "name": "Pytest invalid pattern",
                "snapshot": {
                    "partOverrides": {},
                    "stickers": [{"assetId": "builtin-not-in-catalog"}],
                },
            },
        )
        assert rejected.status_code == 422, rejected.text
        assert rejected.json()["detail"] == "图层引用了不存在的纹样或包裹素材"
    finally:
        if design_id:
            connection = await asyncpg.connect(os.environ["POSTGRES_URL"].replace("+asyncpg", ""))
            try:
                await connection.execute("DELETE FROM cue_designs WHERE id = $1", design_id)
            finally:
                await connection.close()
