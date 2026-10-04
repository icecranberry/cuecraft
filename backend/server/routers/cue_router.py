"""球杆设计工作室 HTTP 适配层。"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from server.utils.auth_middleware import get_admin_user, get_db, get_required_user
from yuxi.repositories.cue_repository import CueRepository
from yuxi.services.builtin_cues import builtin_blank_asset_views
from yuxi.services.cue_ai_service import available_cue_models, enqueue_asset_generation, run_cue_chat
from yuxi.services.cue_proposal_service import get_proposal_variant
from yuxi.services.cue_legacy_import import import_legacy_bundle
from yuxi.services.cue_sharing_service import (
    create_design_share,
    cue_assistant_skills,
    get_work_assistant,
    list_design_shares,
    public_design_share,
    public_design_share_asset,
    revoke_design_share,
    send_work_assistant_message,
    set_work_assistant_skill,
)
from yuxi.services.cue_service import (
    CUE_BUCKET,
    asset_view,
    create_sku_from_design,
    create_asset,
    design_view,
    import_skus,
    parse_sku_file,
    save_design,
    sku_view,
)
from yuxi.storage.minio.client import get_minio_client
from yuxi.storage.postgres.models_business import User
from yuxi.services.task_service import tasker

cue = APIRouter(prefix="/cue", tags=["cue-studio"])


class DesignPayload(BaseModel):
    """可编辑作品快照。"""

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    snapshot: dict[str, Any]


class SkuImportPayload(BaseModel):
    """用户确认过的 SKU 导入行。"""

    rows: list[dict[str, Any]]


class SkuCreatePayload(BaseModel):
    """从作品创建共享目录 SKU。"""

    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    category: str = Field(min_length=1, max_length=100)
    series: str = Field(default="", max_length=100)
    material: str = Field(default="", max_length=255)
    specification: dict[str, Any]
    design_id: str = Field(min_length=1, max_length=64)
    design_version: int = Field(ge=1)


class WorkAssistantPayload(BaseModel):
    """发送一条作品 AI 消息并选择当前 Skill。"""

    message: str = Field(min_length=1, max_length=4000)
    skill_slug: str | None = Field(default=None, max_length=128)
    mode: str = Field(default="chat", pattern="^(chat|cost|vector)$")


class WorkAssistantSkillPayload(BaseModel):
    """设置作品 AI 对话的活动 Skill。"""

    skill_slug: str = Field(min_length=1, max_length=128)


class AssetGenerationPayload(BaseModel):
    """AI 素材生成意图。"""

    kind: str
    name: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1, max_length=4000)
    target_segment_id: str | None = None
    reference_asset_id: str | None = None
    model_spec: str


class CueChatMessage(BaseModel):
    """当前页面中的一条 AI 设计对话消息。"""

    role: str
    content: str = Field(min_length=1, max_length=4000)


class CueChatPayload(BaseModel):
    """AI 设计文字对话请求。"""

    messages: list[CueChatMessage] = Field(min_length=1, max_length=24)
    context: dict[str, Any] = Field(default_factory=dict)


@cue.get("/assets")
async def list_assets(
    kind: str | None = Query(None),
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出共享球杆素材。"""
    builtins = builtin_blank_asset_views(kind)
    return builtins + [asset_view(asset) for asset in await CueRepository(db).list_assets(kind)]


@cue.post("/assets")
async def upload_asset(
    kind: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    tags: str = Form("[]"),
    specification: str = Form("{}"),
    image: UploadFile | None = File(None),
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """上传光杆定义、纹样或包裹图。"""
    try:
        parsed_tags = json.loads(tags)
        parsed_specification = json.loads(specification)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="素材参数 JSON 无效") from exc
    if not isinstance(parsed_tags, list) or not isinstance(parsed_specification, dict):
        raise HTTPException(status_code=422, detail="素材参数格式无效")
    return await create_asset(
        db=db,
        uid=str(current_user.uid),
        kind=kind,
        name=name,
        description=description,
        tags=[str(tag) for tag in parsed_tags],
        specification=parsed_specification,
        image_data=await image.read() if image else None,
    )


@cue.get("/assets/{asset_id}/image")
async def get_asset_image(
    asset_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """通过认证边界返回共享素材图片。"""
    asset = await CueRepository(db).get_asset(asset_id)
    if asset is None or not asset.object_name:
        raise HTTPException(status_code=404, detail="素材图片不存在")
    data = await get_minio_client().adownload_file(CUE_BUCKET, asset.object_name)
    return Response(data, media_type=asset.content_type or "application/octet-stream")


@cue.get("/designs")
async def list_designs(
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户作品。"""
    return [
        design_view(item, include_snapshot=False)
        for item in await CueRepository(db).list_designs(str(current_user.uid))
    ]


@cue.post("/legacy/import")
async def import_cuecraft_bundle(
    file: UploadFile = File(...),
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """由用户主动上传旧站导出的不含密钥资料包。"""
    data = await file.read(100 * 1024 * 1024 + 1)
    return await import_legacy_bundle(db, str(current_user.uid), data)


@cue.post("/designs")
async def create_design(
    payload: DesignPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """创建作品。"""
    return await save_design(db=db, uid=str(current_user.uid), name=payload.name, snapshot=payload.snapshot)


@cue.get("/designs/{design_id}")
async def get_design(
    design_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """读取当前用户的作品快照。"""
    design = await CueRepository(db).get_design(str(current_user.uid), design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    return design_view(design)


@cue.put("/designs/{design_id}")
async def update_design(
    design_id: str,
    payload: DesignPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """保存当前用户的作品新版本。"""
    return await save_design(
        db=db, uid=str(current_user.uid), name=payload.name, snapshot=payload.snapshot, design_id=design_id
    )


@cue.get("/designs/{design_id}/shares")
async def get_design_shares(
    design_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户作品的分享历史。"""
    return await list_design_shares(db=db, uid=str(current_user.uid), design_id=design_id)


@cue.post("/designs/{design_id}/shares")
async def create_design_share_route(
    design_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """创建固定当前版本的匿名 3D 分享链接。"""
    return await create_design_share(db=db, uid=str(current_user.uid), design_id=design_id)


@cue.delete("/designs/{design_id}/shares/{share_id}")
async def revoke_design_share_route(
    design_id: str,
    share_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """立即撤销当前用户创建的分享链接。"""
    await revoke_design_share(db=db, uid=str(current_user.uid), design_id=design_id, share_id=share_id)
    return {"revoked": True}


@cue.get("/share/{token}")
async def get_public_design_share(token: str, db: AsyncSession = Depends(get_db)):
    """无需登录读取分享凭据固定的 3D 作品快照。"""
    return await public_design_share(db=db, token=token)


@cue.get("/share/{token}/assets/{asset_id}/image")
async def get_public_design_share_asset(token: str, asset_id: str, db: AsyncSession = Depends(get_db)):
    """无需登录读取分享快照实际引用的素材图片。"""
    asset = await public_design_share_asset(db=db, token=token, asset_id=asset_id)
    if asset is None or not asset.object_name:
        raise HTTPException(status_code=404, detail="分享素材图片不存在")
    data = await get_minio_client().adownload_file(CUE_BUCKET, asset.object_name)
    return Response(data, media_type=asset.content_type or "application/octet-stream")


@cue.get("/designs/{design_id}/assistant")
async def get_design_assistant(
    design_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """读取或初始化每个作品唯一的 AI 对话。"""
    return await get_work_assistant(db=db, user=current_user, design_id=design_id)


@cue.post("/designs/{design_id}/assistant")
async def send_design_assistant_message(
    design_id: str,
    payload: WorkAssistantPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """在作品专属历史中运行所选 Skill 或功能占位响应。"""
    return await send_work_assistant_message(
        db=db,
        user=current_user,
        design_id=design_id,
        message=payload.message,
        skill_slug=payload.skill_slug,
        mode=payload.mode,
    )


@cue.put("/designs/{design_id}/assistant")
async def update_design_assistant_skill(
    design_id: str,
    payload: WorkAssistantSkillPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """切换作品对话的唯一活动 Skill。"""
    return await set_work_assistant_skill(
        db=db,
        user=current_user,
        design_id=design_id,
        skill_slug=payload.skill_slug,
    )


@cue.get("/ai/skills")
async def list_cue_assistant_skills(
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户可用于作品 AI 对话的 Yuxi Skills。"""
    return await cue_assistant_skills(db=db, user=current_user)


@cue.get("/designs/{design_id}/versions")
async def list_design_versions(
    design_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户作品的历史版本。"""
    repo = CueRepository(db)
    if await repo.get_design(str(current_user.uid), design_id) is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    return [
        {"id": item.id, "version": item.version, "snapshot": item.snapshot}
        for item in await repo.list_versions(design_id)
    ]


@cue.get("/skus")
async def list_skus(
    q: str = Query("", max_length=100),
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """查询单厂家 SKU 目录。"""
    return [sku_view(item) for item in await CueRepository(db).list_skus(q)]


@cue.post("/skus")
async def create_sku_from_design_route(
    payload: SkuCreatePayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """允许作品作者把指定版本发布到厂家共享 SKU 目录。"""
    return await create_sku_from_design(
        db=db,
        uid=str(current_user.uid),
        code=payload.code,
        name=payload.name,
        category=payload.category,
        series=payload.series,
        material=payload.material,
        specification=payload.specification,
        design_id=payload.design_id,
        design_version=payload.design_version,
    )


@cue.post("/skus/import/preview")
async def preview_sku_import(
    file: UploadFile = File(...),
    current_user: User = Depends(get_admin_user),
):
    """解析并预览 CSV/XLSX，返回逐行错误。"""
    return parse_sku_file(await file.read(), file.filename or "")


@cue.post("/skus/import")
async def commit_sku_import(
    payload: SkuImportPayload,
    current_user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """确认后按 SKU 编号新增或更新。"""
    return await import_skus(db, payload.rows)


@cue.get("/ai/models")
async def list_cue_models(current_user: User = Depends(get_required_user)):
    """列出可用于球杆生成的 Yuxi 模型。"""
    return available_cue_models()


@cue.post("/ai/chat")
async def chat_about_cue_design(
    payload: CueChatPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """使用系统默认聊天模型回答当前页面中的球杆设计问题。"""
    try:
        return await run_cue_chat(
            db=db,
            messages=[message.model_dump() for message in payload.messages],
            context=payload.context,
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@cue.post("/ai/jobs")
async def create_cue_ai_job(
    payload: AssetGenerationPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """向 Durable Task 提交素材生成工作。"""
    try:
        return await enqueue_asset_generation(
            db=db,
            uid=str(current_user.uid),
            kind=payload.kind,
            name=payload.name,
            prompt=payload.prompt,
            target_segment_id=payload.target_segment_id,
            reference_asset_id=payload.reference_asset_id,
            model_spec=payload.model_spec,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@cue.get("/ai/jobs/{job_id}")
async def get_cue_ai_job(
    job_id: str,
    current_user: User = Depends(get_required_user),
):
    """只向任务发起者投影持久任务终态。"""
    task = await tasker.get_task(job_id)
    if (
        task is None
        or task.get("type") != "cue_asset_generation"
        or task.get("payload", {}).get("uid") != str(current_user.uid)
    ):
        raise HTTPException(status_code=404, detail="任务不存在")
    return {key: task.get(key) for key in ("id", "status", "progress", "message", "result", "error")}


@cue.get("/ai/proposals/{proposal_id}")
async def get_cue_proposal_variant(
    proposal_id: str,
    variant: int = Query(0, ge=0, le=2),
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """读取当前用户三套 AI 方案中的一个候选。"""
    return await get_proposal_variant(db=db, uid=str(current_user.uid), proposal_id=proposal_id, variant_index=variant)
