"""球杆设计、素材和厂家目录的业务用例。"""

from __future__ import annotations

import csv
import io
import json
import re
import uuid
from typing import Any

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.cue_repository import CueRepository
from yuxi.services.builtin_cues import BUILTIN_BLANK_ASSET_IDS
from yuxi.storage.minio.client import get_minio_client
from yuxi.storage.postgres.models_business import CueAsset, CueDesign, CueDesignVersion, CueSku
from yuxi.utils.datetime_utils import format_utc_datetime

CUE_BUCKET = "cue-assets"
MAX_IMAGE_BYTES = 15 * 1024 * 1024
# 与 web/src/cue-engine/materials/patterns.json 的 builtin-${id} 保持一致；图片由 Web 静态资源提供。
BUILTIN_CUE_PATTERN_ASSET_IDS = frozenset(
    {
        "builtin-jade-spear",
        "builtin-gold-diamond",
        "builtin-silver-vine",
        "builtin-ruyi-cloud",
        "builtin-lotus-scroll",
        "builtin-gold-fret",
        "builtin-ruby-spear",
        "builtin-amber-crown",
        "builtin-obsidian-lance",
        "builtin-pearl-star",
        "builtin-azure-dragon",
        "builtin-phoenix-plume",
        "builtin-bamboo-jade",
        "builtin-plum-blossom",
        "builtin-orchid-orbit",
        "builtin-ocean-wave",
        "builtin-endless-knot",
        "builtin-thunder-key",
        "builtin-diamond-chain",
        "builtin-art-deco-fan",
        "builtin-p-emerald-chevron",
        "builtin-p-sapphire-dagger",
        "builtin-p-copper-flame",
        "builtin-p-violet-lance",
        "builtin-p-walnut-feather",
        "builtin-p-peony-scroll",
        "builtin-p-ginkgo-fan",
        "builtin-p-camellia-vine",
        "builtin-p-iris-ribbon",
        "builtin-p-grape-tendril",
        "builtin-p-crane-cloud",
        "builtin-p-koi-water",
        "builtin-p-lingzhi-ruyi",
        "builtin-p-celestial-ribbon",
        "builtin-p-pomegranate",
        "builtin-p-celtic-braid",
        "builtin-p-hexagon-mosaic",
        "builtin-p-fishscale-jade",
        "builtin-p-gothic-arch",
        "builtin-p-sunburst-spire",
    }
)


def asset_view(asset: CueAsset) -> dict[str, Any]:
    """把共享素材投影为不含内部对象路径的响应。"""
    return {
        "id": asset.id,
        "kind": asset.kind,
        "name": asset.name,
        "description": asset.description,
        "tags": asset.tags or [],
        "specification": asset.specification or {},
        "width_px": asset.width_px,
        "height_px": asset.height_px,
        "has_image": bool(asset.object_name),
        "source": asset.source,
        "created_at": format_utc_datetime(asset.created_at),
    }


def design_view(design: CueDesign, *, include_snapshot: bool = True) -> dict[str, Any]:
    """投影当前用户作品。"""
    data = {
        "id": design.id,
        "name": design.name,
        "version": design.version,
        "created_at": format_utc_datetime(design.created_at),
        "updated_at": format_utc_datetime(design.updated_at),
    }
    if include_snapshot:
        data["snapshot"] = design.snapshot
    return data


def sku_view(sku: CueSku) -> dict[str, Any]:
    """投影厂家 SKU 目录项。"""
    return {
        "code": sku.code,
        "name": sku.name,
        "category": sku.category,
        "series": sku.series,
        "material": sku.material,
        "specification": sku.specification or {},
        "has_image": bool(sku.image_object_name),
        "created_by": sku.created_by,
        "source_design_id": sku.source_design_id,
        "source_design_version": sku.source_design_version,
        "updated_at": format_utc_datetime(sku.updated_at),
    }


def validate_blank_spec(specification: dict[str, Any]) -> None:
    """要求光杆杆段按毫米连续覆盖整杆。"""
    segments = specification.get("segments")
    if not isinstance(segments, list) or not segments or len(segments) > 32:
        raise HTTPException(status_code=422, detail="光杆必须包含 1–32 个杆段")
    end = 0.0
    for segment in segments:
        if not isinstance(segment, dict):
            raise HTTPException(status_code=422, detail="杆段格式无效")
        try:
            start = float(segment["a0"])
            stop = float(segment["a1"])
            r0 = float(segment["r0"])
            r1 = float(segment["r1"])
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="杆段必须提供起止位置和半径") from exc
        if abs(start - end) > 0.01 or stop <= start or not (1 <= r0 <= 30 and 1 <= r1 <= 30):
            raise HTTPException(status_code=422, detail="杆段不连续或尺寸超出可设计范围")
        end = stop
    if not 500 <= end <= 2000:
        raise HTTPException(status_code=422, detail="整杆长度须在 500–2000 毫米之间")


def inspect_image(data: bytes, kind: str, *, min_size: int = 512) -> tuple[str, int, int]:
    """验证上传图像的实际格式及像素尺寸。"""
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="图片大小须在 1 字节到 15 MB 之间")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            image_format = image.format
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=422, detail="图片格式无效") from exc
    if width < min_size or height < min_size or width > 8192 or height > 8192:
        raise HTTPException(status_code=422, detail=f"图片分辨率须在 {min_size}–8192 像素之间")
    if kind == "wrap" and width < 1024:
        raise HTTPException(status_code=422, detail="包裹素材圆周方向至少需要 1024 像素")
    content_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(image_format)
    if not content_type:
        raise HTTPException(status_code=422, detail="仅支持 PNG、JPEG、WebP 图片")
    return content_type, width, height


async def create_asset(
    *,
    db: AsyncSession,
    uid: str,
    kind: str,
    name: str,
    description: str,
    tags: list[str],
    specification: dict[str, Any],
    image_data: bytes | None,
    source: str = "upload",
    commit: bool = True,
    asset_id: str | None = None,
    min_image_size: int = 512,
) -> dict[str, Any]:
    """验证并持久化共享素材及图片。"""
    if kind not in {"blank", "pattern", "wrap"} or not name.strip():
        raise HTTPException(status_code=422, detail="素材类型或名称无效")
    if kind == "blank":
        validate_blank_spec(specification)
    if kind != "blank" and image_data is None:
        raise HTTPException(status_code=422, detail="纹样和包裹素材必须附带图片")
    if kind == "wrap" and not specification.get("target_segment_id"):
        raise HTTPException(status_code=422, detail="包裹素材必须指定目标杆段")

    content_type = None
    width = height = None
    object_name = None
    if image_data is not None:
        content_type, width, height = inspect_image(image_data, kind, min_size=min_image_size)
        extension = content_type.rsplit("/", 1)[1].replace("jpeg", "jpg")
        object_name = f"assets/{uuid.uuid4()}.{extension}"
        await get_minio_client().aupload_file(CUE_BUCKET, object_name, image_data, content_type)

    asset = CueAsset(
        id=asset_id or str(uuid.uuid4()),
        owner_uid=uid,
        kind=kind,
        name=name.strip()[:255],
        description=description.strip()[:2000],
        tags=[tag.strip()[:64] for tag in tags[:20] if tag.strip()],
        specification=specification,
        object_name=object_name,
        content_type=content_type,
        width_px=width,
        height_px=height,
        source=source,
    )
    await CueRepository(db).add_asset(asset)
    if commit:
        await db.commit()
    return asset_view(asset)


async def validate_design_snapshot(db: AsyncSession, snapshot: dict[str, Any]) -> None:
    """校验作品快照引用的素材存在且类型可用。"""
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("partOverrides", {}), dict):
        raise HTTPException(status_code=422, detail="作品快照格式无效")
    stickers = snapshot.get("stickers", [])
    if not isinstance(stickers, list) or len(stickers) > 200:
        raise HTTPException(status_code=422, detail="作品图层数量无效")
    repo = CueRepository(db)
    for sticker in stickers:
        if not isinstance(sticker, dict) or not sticker.get("assetId"):
            raise HTTPException(status_code=422, detail="图层素材 ID 缺失")
        asset_id = str(sticker["assetId"])
        if asset_id in BUILTIN_CUE_PATTERN_ASSET_IDS:
            continue
        asset = await repo.get_asset(asset_id)
        if asset is None or asset.kind not in {"pattern", "wrap"}:
            raise HTTPException(status_code=422, detail="图层引用了不存在的纹样或包裹素材")
    blank_id = snapshot.get("blankAssetId")
    if blank_id and str(blank_id) not in BUILTIN_BLANK_ASSET_IDS:
        blank = await repo.get_asset(str(blank_id))
        if blank is None or blank.kind != "blank":
            raise HTTPException(status_code=422, detail="光杆素材不存在")


async def save_design(
    *, db: AsyncSession, uid: str, name: str, snapshot: dict[str, Any], design_id: str | None = None
) -> dict[str, Any]:
    """保存作品并追加不可变版本。"""
    await validate_design_snapshot(db, snapshot)
    repo = CueRepository(db)
    normalized_name = name.strip()[:255]
    if not normalized_name:
        raise HTTPException(status_code=422, detail="作品名称不能为空")
    if design_id:
        design = await repo.get_design(uid, design_id)
        if design is None:
            raise HTTPException(status_code=404, detail="作品不存在")
        design.version += 1
        design.snapshot = snapshot
        design.name = normalized_name
    else:
        design = CueDesign(id=str(uuid.uuid4()), owner_uid=uid, name=normalized_name, snapshot=snapshot, version=1)
    version = CueDesignVersion(id=str(uuid.uuid4()), design_id=design.id, version=design.version, snapshot=snapshot)
    if design_id:
        await repo.add_version(version)
    else:
        await repo.add_design(design, version)
    await db.commit()
    return design_view(design)


async def create_sku_from_design(
    *,
    db: AsyncSession,
    uid: str,
    code: str,
    name: str,
    category: str,
    series: str,
    material: str,
    specification: dict[str, Any],
    design_id: str,
    design_version: int,
) -> dict[str, Any]:
    """从当前用户作品发布带版本来源的共享 SKU 目录项。"""
    normalized_code = code.strip().upper()
    normalized_name = name.strip()
    normalized_category = category.strip()
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]{0,99}", normalized_code):
        raise HTTPException(status_code=422, detail="SKU 编号仅可包含字母、数字、点、下划线和短横线")
    if not normalized_name or len(normalized_name) > 255 or not normalized_category or len(normalized_category) > 100:
        raise HTTPException(status_code=422, detail="SKU 名称和类别不能为空或超长")
    if not isinstance(specification, dict):
        raise HTTPException(status_code=422, detail="SKU 规格格式无效")
    try:
        dimensions = {
            key: round(float(specification[key]), 2)
            for key in ("length_mm", "tip_diameter_mm", "butt_diameter_mm", "weight_g")
            if specification.get(key) not in (None, "")
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="尺寸和重量必须为数字") from exc
    if "length_mm" not in dimensions or dimensions["length_mm"] <= 0:
        raise HTTPException(status_code=422, detail="必须填写大于零的球杆长度")
    if any(value <= 0 for value in dimensions.values()):
        raise HTTPException(status_code=422, detail="尺寸和重量必须大于零")

    repo = CueRepository(db)
    design = await repo.get_design(uid, design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    if design.version != design_version:
        raise HTTPException(status_code=409, detail="作品版本已更新，请重新打开 SKU 表单")
    if await repo.get_sku(normalized_code) is not None:
        raise HTTPException(status_code=409, detail="SKU 编号已存在，请更换编号")

    item = CueSku(
        code=normalized_code,
        name=normalized_name,
        category=normalized_category,
        series=series.strip()[:100],
        material=material.strip()[:255],
        specification={**dimensions, "source_design_id": design.id, "source_design_version": design.version},
        created_by=uid,
        source_design_id=design.id,
        source_design_version=design.version,
    )
    db.add(item)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(item)
    return sku_view(item)


def parse_sku_file(data: bytes, filename: str) -> list[dict[str, Any]]:
    """解析 CSV 或 XLSX 厂家目录并返回逐行校验结果。"""
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="SKU 文件不能超过 5 MB")
    if filename.lower().endswith(".csv"):
        try:
            rows = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=422, detail="CSV 请使用 UTF-8 编码") from exc
    elif filename.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        from zipfile import BadZipFile

        try:
            workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            sheet = workbook.active
            values = sheet.values
            header = [str(value or "").strip() for value in next(values, [])]
            rows = [dict(zip(header, values_row, strict=False)) for values_row in values]
            workbook.close()
        except (BadZipFile, ValueError, OSError) as exc:
            raise HTTPException(status_code=422, detail="Excel 文件损坏或格式无效") from exc
    else:
        raise HTTPException(status_code=422, detail="仅支持 CSV 或 XLSX 文件")
    if len(rows) > 5000:
        raise HTTPException(status_code=422, detail="一次最多导入 5000 条 SKU")
    result = []
    seen = set()
    for row_number, row in enumerate(rows, start=2):
        code = str(row.get("SKU编号") or row.get("code") or "").strip()
        name = str(row.get("名称") or row.get("name") or "").strip()
        category = str(row.get("类别") or row.get("category") or "").strip()
        errors = []
        if not code or not name or not category:
            errors.append("SKU 编号、名称、类别均为必填")
        if code in seen:
            errors.append("文件内 SKU 编号重复")
        seen.add(code)
        spec_text = row.get("尺寸JSON") or row.get("specification") or "{}"
        try:
            specification = json.loads(spec_text) if isinstance(spec_text, str) else spec_text
            if not isinstance(specification, dict):
                raise ValueError("尺寸必须是对象")
        except (ValueError, TypeError):
            specification = {}
            errors.append("尺寸 JSON 无效")
        result.append(
            {
                "row": row_number,
                "code": code[:100],
                "name": name[:255],
                "category": category[:100],
                "series": str(row.get("系列") or row.get("series") or "").strip()[:100],
                "material": str(row.get("材质") or row.get("material") or "").strip()[:255],
                "specification": specification,
                "errors": errors,
            }
        )
    return result


async def import_skus(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, int]:
    """按 SKU 编号幂等新增或更新厂家目录。"""
    if not rows or len(rows) > 5000 or any(not isinstance(row, dict) or row.get("errors") for row in rows):
        raise HTTPException(status_code=422, detail="导入数据为空或仍有错误")
    codes = [str(row.get("code") or "").strip() for row in rows]
    if len(codes) != len(set(codes)):
        raise HTTPException(status_code=422, detail="导入数据包含重复 SKU 编号")
    repo = CueRepository(db)
    created = updated = 0
    for row in rows:
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        category = str(row.get("category") or "").strip()
        if not code or not name or not category:
            raise HTTPException(status_code=422, detail="SKU 编号、名称、类别均为必填")
        if len(code) > 100 or len(name) > 255 or len(category) > 100:
            raise HTTPException(status_code=422, detail="SKU 编号、名称或类别过长")
        specification = row.get("specification") or {}
        if not isinstance(specification, dict):
            raise HTTPException(status_code=422, detail="SKU 尺寸必须是 JSON 对象")
        sku = await repo.get_sku(code)
        if sku is None:
            sku = CueSku(code=code, name=name, category=category)
            db.add(sku)
            created += 1
        else:
            updated += 1
        sku.name = name
        sku.category = category
        sku.series = str(row.get("series") or "")
        sku.material = str(row.get("material") or "")
        sku.specification = specification
    await db.commit()
    return {"created": created, "updated": updated}
