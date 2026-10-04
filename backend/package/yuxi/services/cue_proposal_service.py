"""球杆方案的目录约束、持久化与编辑副本。"""

from __future__ import annotations

import uuid
import math
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.cue_repository import CueRepository
from yuxi.storage.postgres.models_business import CueProposal

BASE_SEGMENTS = {
    "ferrule": (5.0, 29.0, 6.5, 6.5),
    "shaft": (29.0, 737.0, 6.5, 10.7),
    "joint": (737.0, 750.0, 10.7, 10.8),
    "ring-joint": (750.0, 758.0, 10.8, 10.85),
    "butt-forearm": (758.0, 1142.0, 10.85, 13.45),
    "ring-deco": (1142.0, 1150.0, 13.45, 13.5),
    "grip": (1150.0, 1352.0, 13.5, 14.85),
    "butt-cap": (1352.0, 1474.0, 14.85, 15.7),
}


def _segment_geometry(specification: dict, segment_id: str) -> tuple[float, float, float, float] | None:
    """返回当前杆型的轴向范围与半径，供方案校验和包裹整段覆盖。"""
    segments = specification.get("segments")
    if isinstance(segments, list):
        for segment in segments:
            if isinstance(segment, dict) and segment.get("id") == segment_id:
                try:
                    return tuple(float(segment[key]) for key in ("a0", "a1", "r0", "r1"))
                except (KeyError, TypeError, ValueError):
                    return None
        return None
    base = BASE_SEGMENTS.get(segment_id)
    if base is None:
        return None
    try:
        scale = float(specification.get("length_mm") or 1474) / 1474
    except (TypeError, ValueError):
        return None
    if not 0.3 <= scale <= 1.5:
        return None
    return (base[0] * scale, base[1] * scale, base[2], base[3])


async def catalog_for_proposals(db: AsyncSession, query: str = "") -> dict[str, Any]:
    """给 Agent 提供有限且无用户隐私的可用目录。"""
    repo = CueRepository(db)
    skus = await repo.list_skus(query[:100])
    assets = await repo.list_assets()
    return {
        "skus": [
            {
                "code": sku.code,
                "name": sku.name,
                "category": sku.category,
                "series": sku.series,
                "specification": sku.specification,
            }
            for sku in skus[:30]
        ],
        "assets": [
            {
                "id": asset.id,
                "kind": asset.kind,
                "name": asset.name,
                "description": asset.description[:240],
                "tags": asset.tags,
                "specification": asset.specification,
            }
            for asset in assets[:100]
        ],
    }


async def save_proposals(
    *, db: AsyncSession, uid: str, request_text: str, variants: list[dict[str, Any]]
) -> dict[str, Any]:
    """只保存引用真实目录素材的三套可编辑设计。"""
    if not isinstance(variants, list) or len(variants) != 3:
        raise HTTPException(status_code=422, detail="必须提供三套方案")
    repo = CueRepository(db)
    validated = []
    for index, variant in enumerate(variants):
        if not isinstance(variant, dict):
            raise HTTPException(status_code=422, detail="方案格式无效")
        sku_code = str(variant.get("sku_code") or "").strip() or None
        blank_id = str(variant.get("blank_asset_id") or "").strip() or None
        sku = await repo.get_sku(str(sku_code)) if sku_code else None
        if sku_code and sku is None:
            raise HTTPException(status_code=422, detail=f"方案 {index + 1} 的 SKU 不存在")
        if sku_code and blank_id:
            raise HTTPException(status_code=422, detail="方案不能同时指定 SKU 和光杆素材")
        blank = None
        if blank_id:
            blank = await repo.get_asset(str(blank_id))
            if blank is None or blank.kind != "blank":
                raise HTTPException(status_code=422, detail=f"方案 {index + 1} 的光杆素材不存在")
        overrides = variant.get("part_overrides") or {}
        if not isinstance(overrides, dict) or len(overrides) > 32:
            raise HTTPException(status_code=422, detail="部件材质参数无效")
        layers = variant.get("layers") or []
        if not isinstance(layers, list) or len(layers) > 40:
            raise HTTPException(status_code=422, detail="方案图层数量无效")
        stickers = []
        specification = (blank.specification if blank else sku.specification if sku else {}) or {}
        for layer_index, layer in enumerate(layers):
            if not isinstance(layer, dict):
                raise HTTPException(status_code=422, detail="方案图层格式无效")
            asset_id = str(layer.get("asset_id") or "")
            asset = await repo.get_asset(asset_id)
            if asset is None or asset.kind not in {"pattern", "wrap"}:
                raise HTTPException(status_code=422, detail="方案引用了不存在的纹样或包裹素材")
            segment_id = str(layer.get("segment_id") or "")
            geometry = _segment_geometry(specification, segment_id)
            if geometry is None:
                raise HTTPException(status_code=422, detail="方案图层的目标部件无效")
            if asset.kind == "wrap" and asset.specification.get("target_segment_id") != segment_id:
                raise HTTPException(status_code=422, detail="包裹素材与方案目标杆段不匹配")
            try:
                width = float(layer.get("width_mm") or 70)
                height = float(layer.get("height_mm") or 70)
                axial = float(
                    layer.get("axial_mm") if layer.get("axial_mm") is not None else (geometry[0] + geometry[1]) / 2
                )
                angle = float(layer.get("angle_deg") or 0)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail="方案图层尺寸无效") from exc
            if asset.kind == "wrap":
                width = math.pi * (geometry[2] + geometry[3])
                height = geometry[1] - geometry[0]
                axial = (geometry[0] + geometry[1]) / 2
                angle = 0
            if not (
                1 <= width <= 500
                and 1 <= height <= 1500
                and geometry[0] <= axial <= geometry[1]
                and -360 <= angle <= 360
            ):
                raise HTTPException(status_code=422, detail="方案图层尺寸超出范围")
            stickers.append(
                {
                    "id": str(uuid.uuid4()),
                    "name": asset.name,
                    "assetId": asset.id,
                    "processedRev": 0,
                    "target": {"kind": "lathe", "segId": segment_id, "a": axial, "angDeg": angle},
                    "w": width,
                    "h": height,
                    "rotDeg": 0,
                    "flipX": False,
                    "flipY": False,
                    "opacity": 1,
                    "z": layer_index + 1,
                    "hidden": False,
                    "locked": False,
                }
            )
        title = str(variant.get("title") or f"方案 {index + 1}")[:100]
        snapshot = {
            "name": title,
            "cueTemplateId": "nineball",
            "partOverrides": overrides,
            "globalFinish": variant.get("finish") if variant.get("finish") in {"gloss", "semi", "matte"} else "gloss",
            "stickers": stickers,
            "sourceSku": sku_code,
            "blankAssetId": blank_id,
        }
        validated.append({"title": title, "reason": str(variant.get("reason") or "")[:500], "snapshot": snapshot})
    record = await repo.add_proposal(
        CueProposal(id=str(uuid.uuid4()), owner_uid=uid, request_text=request_text[:4000], variants=validated)
    )
    await db.commit()
    return {"id": record.id, "variants": validated}


async def get_proposal_variant(*, db: AsyncSession, uid: str, proposal_id: str, variant_index: int) -> dict[str, Any]:
    """按所有者和候选序号读取方案快照。"""
    record = await CueRepository(db).get_proposal(uid, proposal_id)
    if record is None:
        raise HTTPException(status_code=404, detail="方案不存在")
    if not 0 <= variant_index < len(record.variants):
        raise HTTPException(status_code=404, detail="方案候选不存在")
    return {"id": record.id, "variant": variant_index, **record.variants[variant_index]}
