"""球杆作品匿名分享与作品级 AI 对话用例。"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.cue_repository import CueRepository
from yuxi.services.cue_ai_service import run_cue_chat
from yuxi.services.skills.catalog import list_accessible_skills
from yuxi.services.skills.edit import read_skill_file
from yuxi.services.skills.personal import read_personal_skill_file
from yuxi.storage.postgres.models_business import CueDesignShare, CueWorkAssistant, User
from yuxi.utils.datetime_utils import format_utc_datetime, utc_now_naive

COST_SKILL_SLUG = "cue-cost-estimation"
VECTOR_PLACEHOLDER_SKILL_SLUG = "cue-vector-conversion-placeholder"
ASSISTANT_CONTEXT_WINDOW = 22


def _token_hash(token: str) -> str:
    """返回匿名凭据的不可逆摘要。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def design_share_view(share: CueDesignShare) -> dict[str, Any]:
    """投影不含秘密 token 的作品分享记录。"""
    return {
        "id": share.id,
        "design_version": share.design_version,
        "design_name": share.design_name,
        "active": share.revoked_at is None,
        "created_at": format_utc_datetime(share.created_at),
        "revoked_at": format_utc_datetime(share.revoked_at),
    }


async def create_design_share(*, db: AsyncSession, uid: str, design_id: str) -> dict[str, Any]:
    """为作品当前版本建立一个可撤销匿名链接。"""
    repo = CueRepository(db)
    design = await repo.get_design(uid, design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    version = await repo.get_design_version(design.id, design.version)
    if version is None:
        raise HTTPException(status_code=409, detail="作品当前版本不可分享")

    token = secrets.token_urlsafe(32)
    share = CueDesignShare(
        id=str(uuid.uuid4()),
        owner_uid=uid,
        design_id=design.id,
        design_version=design.version,
        design_name=design.name,
        token_hash=_token_hash(token),
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return {**design_share_view(share), "token": token, "path": f"/cue/share/{token}"}


async def list_design_shares(*, db: AsyncSession, uid: str, design_id: str) -> list[dict[str, Any]]:
    """列出作品历史分享并检查作品所有权。"""
    repo = CueRepository(db)
    if await repo.get_design(uid, design_id) is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    return [design_share_view(item) for item in await repo.list_design_shares(uid, design_id)]


async def revoke_design_share(*, db: AsyncSession, uid: str, design_id: str, share_id: str) -> None:
    """撤销当前用户作品的一条匿名分享。"""
    share = await CueRepository(db).get_design_share(uid, design_id, share_id)
    if share is None:
        raise HTTPException(status_code=404, detail="分享链接不存在")
    if share.revoked_at is None:
        share.revoked_at = utc_now_naive()
        await db.commit()


async def public_design_share(*, db: AsyncSession, token: str) -> dict[str, Any]:
    """读取匿名分享固定的作品版本及其中实际引用的素材。"""
    repo = CueRepository(db)
    share = await repo.get_active_share_by_token_hash(_token_hash(token))
    if share is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已撤销")
    design = await repo.get_design(share.owner_uid, share.design_id)
    version = await repo.get_design_version(share.design_id, share.design_version)
    if design is None or version is None:
        raise HTTPException(status_code=404, detail="分享作品不存在")

    referenced_ids = {
        str(item.get("assetId"))
        for item in version.snapshot.get("stickers", [])
        if isinstance(item, dict) and item.get("assetId")
    }
    assets = []
    for asset_id in sorted(referenced_ids):
        asset = await repo.get_asset(asset_id)
        if asset is not None:
            assets.append(
                {
                    "id": asset.id,
                    "name": asset.name,
                    "kind": asset.kind,
                    "source": asset.source,
                    "tags": asset.tags or [],
                    "width_px": asset.width_px,
                    "height_px": asset.height_px,
                    "has_image": bool(asset.object_name),
                }
            )
    snapshot = version.snapshot
    return {
        "name": share.design_name or design.name,
        "version": share.design_version,
        "snapshot": snapshot,
        "assets": assets,
        "specification": {
            "template": snapshot.get("cueTemplate") or {},
            "source_sku": snapshot.get("sourceSku"),
            "sku_specification": snapshot.get("skuSpecification") or {},
            "overrides": snapshot.get("partOverrides") or {},
        },
    }


async def public_design_share_asset(*, db: AsyncSession, token: str, asset_id: str):
    """仅在素材被分享快照引用时返回其内部记录。"""
    public = await public_design_share(db=db, token=token)
    if asset_id not in {asset["id"] for asset in public["assets"]}:
        raise HTTPException(status_code=404, detail="分享中没有这张素材")
    return await CueRepository(db).get_asset(asset_id)


async def cue_assistant_skills(*, db: AsyncSession, user: User) -> list[dict[str, Any]]:
    """返回当前用户可在球杆作品对话中使用的 Skills。"""
    return [
        {"slug": item.slug, "name": item.name, "description": item.description}
        for item in await list_accessible_skills(db, user)
    ]


async def _assistant_skill_content(*, db: AsyncSession, user: User, slug: str) -> str:
    """从当前用户实际可读的 Skill 来源读取说明。"""
    skill = next((item for item in await list_accessible_skills(db, user) if item.slug == slug), None)
    if skill is None:
        raise HTTPException(status_code=422, detail="所选 Skill 不可用")
    if skill.source_scope == "builtin":
        return (Path(skill.source_dir) / "SKILL.md").read_text(encoding="utf-8")
    if skill.source_scope == "personal":
        return str((await read_personal_skill_file(str(user.uid), slug, "SKILL.md"))["content"])
    return str((await read_skill_file(db, slug=slug, relative_path="SKILL.md", operator=user))["content"])


async def get_work_assistant(*, db: AsyncSession, user: User, design_id: str) -> dict[str, Any]:
    """读取或创建每个作品唯一的 AI 对话历史。"""
    repo = CueRepository(db)
    if await repo.get_design(str(user.uid), design_id) is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    assistant = await repo.get_work_assistant(str(user.uid), design_id)
    if assistant is None:
        assistant = CueWorkAssistant(
            id=str(uuid.uuid4()),
            owner_uid=str(user.uid),
            design_id=design_id,
            active_skill_slug=COST_SKILL_SLUG,
            messages=[],
        )
        await repo.add_work_assistant(assistant)
        await db.commit()
        await db.refresh(assistant)
    return {
        "design_id": design_id,
        "active_skill_slug": assistant.active_skill_slug,
        "messages": assistant.messages or [],
    }


async def set_work_assistant_skill(
    *, db: AsyncSession, user: User, design_id: str, skill_slug: str
) -> dict[str, Any]:
    """切换并持久化当前作品对话的唯一活动 Skill。"""
    if await CueRepository(db).get_design(str(user.uid), design_id) is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    await _assistant_skill_content(db=db, user=user, slug=skill_slug)
    await get_work_assistant(db=db, user=user, design_id=design_id)
    assistant = await CueRepository(db).get_work_assistant(str(user.uid), design_id)
    if assistant is None:
        raise HTTPException(status_code=409, detail="作品 AI 对话暂不可用")
    assistant.active_skill_slug = skill_slug
    await db.commit()
    return {
        "design_id": design_id,
        "active_skill_slug": assistant.active_skill_slug,
        "messages": assistant.messages or [],
    }


async def send_work_assistant_message(
    *,
    db: AsyncSession,
    user: User,
    design_id: str,
    message: str,
    skill_slug: str | None,
    mode: str,
) -> dict[str, Any]:
    """把当前作品、用户私有作品和唯一活动 Skill 送入持久对话。"""
    normalized_message = message.strip()
    if not normalized_message or len(normalized_message) > 4000:
        raise HTTPException(status_code=422, detail="消息必须为 1–4000 个字符")
    if mode not in {"chat", "cost", "vector"}:
        raise HTTPException(status_code=422, detail="不支持的作品 AI 模式")

    repo = CueRepository(db)
    design = await repo.get_design(str(user.uid), design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="作品不存在")
    assistant = await repo.get_work_assistant(str(user.uid), design_id)
    if assistant is None:
        await get_work_assistant(db=db, user=user, design_id=design_id)
        assistant = await repo.get_work_assistant(str(user.uid), design_id)
    assert assistant is not None

    if mode == "cost":
        selected_slug = COST_SKILL_SLUG
        normalized_message = (
            "请按当前球杆设计和我在 Yuxi 保存的其他作品，估算单支制作成本人民币区间。"
            "没有工厂成本数据时请直接给粗估并说明假设。\n\n用户补充：" + normalized_message
        )
    elif mode == "vector":
        selected_slug = VECTOR_PLACEHOLDER_SKILL_SLUG
    else:
        selected_slug = (skill_slug or assistant.active_skill_slug or COST_SKILL_SLUG).strip()

    skill_text = await _assistant_skill_content(db=db, user=user, slug=selected_slug)
    previous_messages = list(assistant.messages or [])
    history = previous_messages[-ASSISTANT_CONTEXT_WINDOW:]
    if selected_slug == VECTOR_PLACEHOLDER_SKILL_SLUG:
        answer = "球杆纹样矢量转换功能尚未完成，目前不会转换或生成 SVG、AI、DXF 等文件。请先保留原始高分辨率图片。"
    else:
        other_works = [
            {"id": item.id, "name": item.name, "version": item.version, "snapshot": item.snapshot}
            for item in await repo.list_designs(str(user.uid))
        ]
        context = {
            "cue_name": design.name,
            "cue_type": (design.snapshot.get("cueTemplate") or {}).get("name", ""),
            "work_snapshot": design.snapshot,
            "all_saved_works": other_works,
        }
        reply = await run_cue_chat(
            db=db,
            messages=[*history, {"role": "user", "content": normalized_message}],
            context=context,
            skill_instructions=skill_text,
        )
        answer = reply["message"]
        if mode == "cost":
            answer = f"{answer.rstrip()}\n\n**AI 粗估，非正式报价。**"

    now = format_utc_datetime(utc_now_naive())
    assistant.active_skill_slug = selected_slug
    assistant.messages = [
        *previous_messages,
        {"role": "user", "content": normalized_message, "skill_slug": selected_slug, "created_at": now},
        {"role": "assistant", "content": answer, "skill_slug": selected_slug, "created_at": now},
    ]
    await db.commit()
    return {
        "design_id": design_id,
        "active_skill_slug": selected_slug,
        "messages": assistant.messages,
        "reply": assistant.messages[-1],
    }
