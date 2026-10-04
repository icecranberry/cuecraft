"""把旧 CueCraft 浏览器资料包迁移为 Yuxi 共享素材和个人作品。"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.cue_repository import CueRepository
from yuxi.services.cue_service import create_asset, validate_design_snapshot
from yuxi.storage.postgres.models_business import CueDesign, CueDesignVersion

MAX_BUNDLE_BYTES = 100 * 1024 * 1024


def _bundle_id(uid: str, digest: str, category: str, legacy_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"cuecraft:{uid}:{digest}:{category}:{legacy_id}"))


def _read_bundle(data: bytes) -> tuple[list[dict], list[dict]]:
    if not data or len(data) > MAX_BUNDLE_BYTES:
        raise HTTPException(status_code=413, detail="迁移资料包大小须在 1 字节到 100 MB 之间")
    try:
        document = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="迁移资料包不是有效 JSON") from exc
    if not isinstance(document, dict) or document.get("format") != "cuecraft-legacy-v1":
        raise HTTPException(status_code=422, detail="迁移资料包版本无效")
    assets, works = document.get("assets"), document.get("works")
    if not isinstance(assets, list) or not isinstance(works, list) or len(assets) > 500 or len(works) > 500:
        raise HTTPException(status_code=422, detail="素材或作品列表无效，单次最多各 500 项")
    if any(not isinstance(item, dict) for item in [*assets, *works]):
        raise HTTPException(status_code=422, detail="迁移资料包项目格式无效")
    for category, records in (("素材", assets), ("作品", works)):
        ids = [str(record.get("legacy_id") or "") for record in records]
        if any(not item for item in ids) or len(ids) != len(set(ids)):
            raise HTTPException(status_code=422, detail=f"{category}旧 ID 缺失或重复")
    if any(not isinstance(item.get("tags", []), list) for item in assets):
        raise HTTPException(status_code=422, detail="素材标签格式无效")
    if any(
        not isinstance(item.get("snapshot"), dict) or not isinstance(item["snapshot"].get("stickers", []), list)
        for item in works
    ):
        raise HTTPException(status_code=422, detail="作品快照或图层格式无效")
    return assets, works


async def import_legacy_bundle(db: AsyncSession, uid: str, data: bytes) -> dict[str, int]:
    """同一资料包重复导入时跳过既有记录，并保留旧图层的外观。"""
    assets, works = _read_bundle(data)
    digest = hashlib.sha256(data).hexdigest()
    repo = CueRepository(db)
    asset_ids = {str(item["legacy_id"]): _bundle_id(uid, digest, "asset", str(item["legacy_id"])) for item in assets}
    imported_assets = imported_works = skipped_assets = skipped_works = 0

    for item in assets:
        legacy_id = str(item["legacy_id"])
        asset_id = asset_ids[legacy_id]
        if await repo.get_asset(asset_id):
            skipped_assets += 1
            continue
        encoded = item.get("image_base64")
        if not isinstance(encoded, str):
            raise HTTPException(status_code=422, detail=f"素材 {legacy_id} 缺少图片")
        try:
            image_data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=422, detail=f"素材 {legacy_id} 图片编码无效") from exc
        await create_asset(
            db=db,
            uid=uid,
            kind="pattern",
            name=str(item.get("name") or legacy_id),
            description=str(item.get("description") or ""),
            tags=[str(tag) for tag in item.get("tags", []) if isinstance(tag, str)],
            specification={"legacy_id": legacy_id, "bundle_digest": digest},
            image_data=image_data,
            source="legacy",
            asset_id=asset_id,
            min_image_size=1,
        )
        imported_assets += 1

    for item in works:
        legacy_id = str(item["legacy_id"])
        design_id = _bundle_id(uid, digest, "work", legacy_id)
        if await repo.get_design(uid, design_id):
            skipped_works += 1
            continue
        original = item.get("snapshot")
        if not isinstance(original, dict):
            raise HTTPException(status_code=422, detail=f"作品 {legacy_id} 快照无效")
        snapshot: dict[str, Any] = json.loads(json.dumps(original))
        for sticker in snapshot.get("stickers", []):
            if not isinstance(sticker, dict):
                raise HTTPException(status_code=422, detail=f"作品 {legacy_id} 图层无效")
            old_asset_id = str(sticker.get("assetId") or "")
            if old_asset_id not in asset_ids:
                raise HTTPException(status_code=422, detail=f"作品 {legacy_id} 引用了资料包外的素材")
            sticker["assetId"] = asset_ids[old_asset_id]
            sticker.pop("processedKey", None)
        await validate_design_snapshot(db, snapshot)
        name = str(item.get("name") or snapshot.get("name") or legacy_id).strip()[:255]
        design = CueDesign(id=design_id, owner_uid=uid, name=name, snapshot=snapshot, version=1)
        version = CueDesignVersion(id=str(uuid.uuid4()), design_id=design_id, version=1, snapshot=snapshot)
        await repo.add_design(design, version)
        await db.commit()
        imported_works += 1

    return {
        "assets": imported_assets,
        "works": imported_works,
        "skipped_assets": skipped_assets,
        "skipped_works": skipped_works,
    }
