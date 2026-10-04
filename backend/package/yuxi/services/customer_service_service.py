"""客服 Agent 草稿发布、公开会话与凭据限流用例。"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.agent_repository import AgentRepository
from yuxi.repositories.customer_service_repository import CustomerServiceRepository
from yuxi.services.agent_request_service import AgentRequestInput, RunOrigin, submit_agent_request
from yuxi.services.agent_run_service import AgentRunWaitTimeout, await_agent_run_result
from yuxi.services.input_message_service import build_chat_input_message
from yuxi.storage.postgres.models_business import Agent, CustomerServiceDeployment, User
from yuxi.storage.redis import get_async_redis_client
from yuxi.utils.datetime_utils import format_utc_datetime, utc_now_naive
from yuxi.utils.hash_utils import hash_id

DEPLOYMENT_MODES = {"share", "iframe", "webhook", "mcp"}
PUBLIC_CHAT_TIMEOUT_SECONDS = 90
PUBLIC_RATE_WINDOW_SECONDS = 60
PUBLIC_RATE_LIMIT = 20


def _token_hash(token: str) -> str:
    """返回部署 bearer token 的 SHA-256 摘要。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_iframe_origins(origins: list[str]) -> list[str]:
    """校验并规范化 iframe 的精确 Origin 白名单。"""
    if len(origins) > 20:
        raise HTTPException(status_code=422, detail="iframe 域名最多配置 20 个")
    normalized = set()
    for value in origins:
        raw = str(value).strip()
        try:
            parsed = urlsplit(raw)
            parsed.port
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"iframe Origin 格式无效：{raw[:160]}") from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise HTTPException(status_code=422, detail=f"iframe Origin 格式无效：{raw[:160]}")
        normalized.add(f"{parsed.scheme}://{parsed.netloc.lower()}")
    return sorted(normalized)


def validate_deployment_modes(modes: list[str], iframe_origins: list[str]) -> list[str]:
    """校验一个部署至少发布一种受支持的入口。"""
    normalized = sorted(set(str(mode).strip() for mode in modes))
    if not normalized or any(mode not in DEPLOYMENT_MODES for mode in normalized):
        raise HTTPException(status_code=422, detail="至少选择一种有效的发布方式")
    if "iframe" in normalized and not iframe_origins:
        raise HTTPException(status_code=422, detail="启用 iframe 前必须配置允许嵌入的 Origin")
    return normalized


def deployment_view(item: CustomerServiceDeployment) -> dict[str, Any]:
    """投影部署草稿、已发布版本和凭据状态。"""
    return {
        "id": item.id,
        "name": item.name,
        "draft_agent_slug": item.draft_agent_slug,
        "draft_modes": item.draft_modes or [],
        "draft_iframe_origins": item.draft_iframe_origins or [],
        "published_agent_slug": item.published_agent_slug,
        "published_revision": item.published_revision,
        "published_modes": item.published_modes or [],
        "published_iframe_origins": item.published_iframe_origins or [],
        "published_at": format_utc_datetime(item.published_at),
        "revoked_at": format_utc_datetime(item.revoked_at),
        "token_configured": bool(item.public_token_hash),
        "is_live": bool(item.published_agent_slug and item.public_token_hash and not item.revoked_at),
        "created_at": format_utc_datetime(item.created_at),
        "updated_at": format_utc_datetime(item.updated_at),
    }


def _private_share_config(uid: str) -> dict[str, Any]:
    """把发布快照限定为部署所有者可见的 Agent。"""
    return {
        "version": 2,
        "read_scope": {"access_level": "user", "department_ids": [], "user_uids": [uid]},
        "manage_scope": None,
    }


async def list_deployments(*, db: AsyncSession, uid: str) -> list[dict[str, Any]]:
    """列出当前用户拥有的客服部署。"""
    items = await CustomerServiceRepository(db).list_for_owner(uid)
    return [deployment_view(item) for item in items]


async def create_deployment(
    *, db: AsyncSession, user: User, name: str, agent_slug: str
) -> dict[str, Any]:
    """以当前用户可访问的 Agent 创建未发布部署。"""
    agent = await AgentRepository(db).get_visible_by_slug(slug=agent_slug, user=user, kind="main")
    if agent is None:
        raise HTTPException(status_code=404, detail="智能体不存在或不可访问")
    item = CustomerServiceDeployment(
        id=str(uuid.uuid4()),
        owner_uid=str(user.uid),
        name=name.strip()[:255] or agent.name,
        draft_agent_slug=agent.slug,
        draft_modes=["share", "webhook", "mcp"],
        draft_iframe_origins=[],
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return deployment_view(item)


async def update_deployment_draft(
    *,
    db: AsyncSession,
    user: User,
    deployment_id: str,
    name: str,
    agent_slug: str,
    modes: list[str],
    iframe_origins: list[str],
) -> dict[str, Any]:
    """保存客服草稿，不修改当前已发布快照。"""
    repo = CustomerServiceRepository(db)
    item = await repo.get_for_owner(str(user.uid), deployment_id, for_update=True)
    if item is None:
        raise HTTPException(status_code=404, detail="部署不存在")
    agent = await AgentRepository(db).get_visible_by_slug(slug=agent_slug, user=user, kind="main")
    if agent is None:
        raise HTTPException(status_code=404, detail="智能体不存在或不可访问")
    normalized_origins = normalize_iframe_origins(iframe_origins)
    item.name = name.strip()[:255] or agent.name
    item.draft_agent_slug = agent.slug
    item.draft_modes = validate_deployment_modes(modes, normalized_origins)
    item.draft_iframe_origins = normalized_origins
    await db.commit()
    await db.refresh(item)
    return deployment_view(item)


async def publish_deployment(*, db: AsyncSession, user: User, deployment_id: str) -> dict[str, Any]:
    """复制 Agent 当前配置到隐藏快照并发布草稿修订。"""
    repo = CustomerServiceRepository(db)
    item = await repo.get_for_owner(str(user.uid), deployment_id, for_update=True)
    if item is None:
        raise HTTPException(status_code=404, detail="部署不存在")
    modes = validate_deployment_modes(
        item.draft_modes or [],
        normalize_iframe_origins(item.draft_iframe_origins or []),
    )
    source = await AgentRepository(db).get_visible_by_slug(
        slug=item.draft_agent_slug,
        user=user,
        kind="main",
    )
    if source is None:
        raise HTTPException(status_code=404, detail="草稿智能体不存在或不可访问")

    revision = item.published_revision + 1
    snapshot_slug = f"cs-snapshot-{item.id[:12]}-r{revision}-{uuid.uuid4().hex[:8]}"
    snapshot = Agent(
        slug=snapshot_slug,
        backend_id=source.backend_id,
        name=f"{item.name} · 发布版 {revision}"[:100],
        description=source.description,
        icon=source.icon,
        pics=list(source.pics or []),
        config_json=json.loads(json.dumps(source.config_json or {}, ensure_ascii=False)),
        share_config=_private_share_config(str(user.uid)),
        is_default=False,
        is_subagent=False,
        is_customer_service_snapshot=True,
        created_by=str(user.uid),
        updated_by=str(user.uid),
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db.add(snapshot)
    await db.flush()

    new_token = None
    if item.public_token_hash is None or item.revoked_at is not None:
        new_token = secrets.token_urlsafe(32)
        item.public_token_hash = _token_hash(new_token)
        item.token_rotated_at = utc_now_naive()
    snapshot_payload = {
        "source_agent_slug": source.slug,
        "snapshot_agent_slug": snapshot_slug,
        "config_json": source.config_json or {},
        "backend_id": source.backend_id,
    }
    item.published_agent_slug = snapshot_slug
    item.published_revision = revision
    item.published_modes = modes
    item.published_iframe_origins = list(item.draft_iframe_origins or [])
    item.published_config_hash = hashlib.sha256(
        json.dumps(snapshot_payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    item.published_at = utc_now_naive()
    item.revoked_at = None
    await db.commit()
    await db.refresh(item)
    return {"deployment": deployment_view(item), "public_token": new_token}


async def rotate_deployment_token(*, db: AsyncSession, uid: str, deployment_id: str) -> dict[str, Any]:
    """轮换分享链接和集成凭据，并立即使旧 token 失效。"""
    item = await CustomerServiceRepository(db).get_for_owner(uid, deployment_id, for_update=True)
    if item is None or item.published_agent_slug is None:
        raise HTTPException(status_code=404, detail="已发布部署不存在")
    token = secrets.token_urlsafe(32)
    item.public_token_hash = _token_hash(token)
    item.token_rotated_at = utc_now_naive()
    item.revoked_at = None
    await db.commit()
    return {"deployment": deployment_view(item), "public_token": token}


async def revoke_deployment(*, db: AsyncSession, uid: str, deployment_id: str) -> dict[str, Any]:
    """撤销所有匿名分享、Webhook 和 MCP 调用入口。"""
    item = await CustomerServiceRepository(db).get_for_owner(uid, deployment_id, for_update=True)
    if item is None:
        raise HTTPException(status_code=404, detail="部署不存在")
    if item.revoked_at is None:
        item.revoked_at = utc_now_naive()
        await db.commit()
    return deployment_view(item)


async def public_deployment(*, db: AsyncSession, token: str) -> CustomerServiceDeployment:
    """按 bearer token 读取当前已发布且未撤销的客服部署。"""
    item = await CustomerServiceRepository(db).get_active_by_token_hash(_token_hash(token))
    if item is None:
        raise HTTPException(status_code=404, detail="客服分享链接不存在或已撤销")
    return item


def require_deployment_mode(item: CustomerServiceDeployment, mode: str) -> None:
    """检查当前已发布修订是否开放了指定入口。"""
    if mode not in (item.published_modes or []):
        raise HTTPException(status_code=404, detail="该部署没有启用此接入方式")


async def public_deployment_info(*, db: AsyncSession, token: str, mode: str = "share") -> dict[str, Any]:
    """返回匿名客服页面所需的最小公开配置。"""
    item = await public_deployment(db=db, token=token)
    require_deployment_mode(item, mode)
    agent = await AgentRepository(db).get_by_slug(item.published_agent_slug)
    if agent is None:
        raise HTTPException(status_code=404, detail="已发布智能体不可用")
    return {
        "name": item.name,
        "agent_name": agent.name,
        "revision": item.published_revision,
        "welcome_message": f"您好，我是{item.name}的智能客服，请问有什么可以帮您？",
        "mode": mode,
    }


async def check_public_rate_limit(*, deployment_id: str, client_ip: str) -> None:
    """在 Redis 的滑动窗口内限制每个部署和来源 IP 的调用频率。"""
    redis = await get_async_redis_client()
    now = datetime.now().timestamp()
    key = f"yuxi:customer-service:rate:{deployment_id}:{hashlib.sha256(client_ip.encode()).hexdigest()[:24]}"
    member = f"{now}-{uuid.uuid4().hex}"
    script = """
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
    local count = redis.call('ZCARD', KEYS[1])
    if count >= limit then
      local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
      return {0, math.ceil(tonumber(first[2]) + window - now)}
    end
    redis.call('ZADD', KEYS[1], now, ARGV[4])
    redis.call('EXPIRE', KEYS[1], window)
    return {1, 0}
    """
    allowed, retry_after = await redis.eval(
        script,
        1,
        key,
        now,
        PUBLIC_RATE_WINDOW_SECONDS,
        PUBLIC_RATE_LIMIT,
        member,
    )
    if int(allowed) == 0:
        raise HTTPException(
            status_code=429,
            detail="客服请求过于频繁，请稍后再试",
            headers={"Retry-After": str(max(1, int(retry_after)))},
        )


async def run_customer_service_test_message(
    *,
    db: AsyncSession,
    user: User,
    deployment: CustomerServiceDeployment,
    message: str,
    session_id: str,
    idempotency_key: str,
) -> dict[str, Any]:
    """用部署草稿 Agent 创建单独标记的内部客服测试会话。"""
    agent = await AgentRepository(db).get_visible_by_slug(
        slug=deployment.draft_agent_slug,
        user=user,
        kind="main",
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="草稿智能体不存在或不可访问")
    normalized_message = message.strip()
    normalized_session = session_id.strip()
    normalized_key = idempotency_key.strip()
    if not normalized_message or len(normalized_message) > 4000:
        raise HTTPException(status_code=422, detail="消息必须为 1–4000 个字符")
    if not normalized_session or len(normalized_session) > 128:
        raise HTTPException(status_code=422, detail="session_id 必须为 1–128 个字符")
    if not normalized_key or len(normalized_key) > 128:
        raise HTTPException(status_code=422, detail="idempotency_key 必须为 1–128 个字符")
    thread_id = hash_id("cstest_", f"{deployment.id}:{user.uid}:{normalized_session}", length=64)
    request_id = hash_id("cstestreq_", f"{deployment.id}:{normalized_key}", length=64)
    response = await submit_agent_request(
        request_input=AgentRequestInput(
            agent_slug=agent.slug,
            thread_id=thread_id,
            request_id=request_id,
            input_message=build_chat_input_message(normalized_message),
            origin=RunOrigin(
                source="customer_service_test",
                channel="workbench",
                external_id=hash_id("cstestext_", normalized_session, length=64),
                metadata={"deployment_id": deployment.id},
            ),
            request_metadata={"deployment_id": deployment.id, "purpose": "customer_service_test"},
            queue_policy="reject",
            create_conversation=True,
            conversation_title=f"客服测试 · {deployment.name}",
        ),
        current_user=user,
        db=db,
    )
    run_id = response.get("run_id")
    if response.get("status") == "rejected" or not run_id:
        raise HTTPException(status_code=409, detail="当前测试会话正在处理其他消息，请稍后重试")
    try:
        result = await asyncio.wait_for(
            await_agent_run_result(run_id=str(run_id), current_uid=str(user.uid)),
            timeout=PUBLIC_CHAT_TIMEOUT_SECONDS,
        )
    except (AgentRunWaitTimeout, TimeoutError) as exc:
        raise HTTPException(status_code=504, detail="测试回复超时；Run 仍可在 Yuxi 对话记录中查看") from exc
    if result.get("status") != "completed":
        raise HTTPException(status_code=502, detail="客服测试运行失败")
    return {"answer": result.get("output") or "", "session_id": normalized_session, "run_id": str(run_id)}


async def run_public_customer_message(
    *,
    db: AsyncSession,
    deployment: CustomerServiceDeployment,
    message: str,
    session_id: str,
    idempotency_key: str,
    channel: str,
) -> dict[str, Any]:
    """将匿名消息投递给固定发布 Agent 并等待真实 AgentRun 终态。"""
    normalized_message = message.strip()
    normalized_session = session_id.strip()
    normalized_key = idempotency_key.strip()
    if not normalized_message or len(normalized_message) > 4000:
        raise HTTPException(status_code=422, detail="消息必须为 1–4000 个字符")
    if not normalized_session or len(normalized_session) > 128:
        raise HTTPException(status_code=422, detail="session_id 必须为 1–128 个字符")
    if not normalized_key or len(normalized_key) > 128:
        raise HTTPException(status_code=422, detail="idempotency_key 必须为 1–128 个字符")
    user = await db.scalar(select(User).where(User.uid == deployment.owner_uid, User.is_deleted == 0))
    if user is None:
        raise HTTPException(status_code=503, detail="部署所有者账户不可用")

    thread_id = hash_id("csthread_", f"{deployment.id}:{normalized_session}", length=64)
    request_id = hash_id("csreq_", f"{deployment.id}:{normalized_key}", length=64)
    response = await submit_agent_request(
        request_input=AgentRequestInput(
            agent_slug=str(deployment.published_agent_slug),
            thread_id=thread_id,
            request_id=request_id,
            input_message=build_chat_input_message(normalized_message),
            origin=RunOrigin(
                source="customer_service",
                channel=channel,
                external_id=hash_id("csext_", normalized_session, length=64),
                metadata={"deployment_id": deployment.id, "revision": deployment.published_revision},
            ),
            request_metadata={"deployment_id": deployment.id, "deployment_revision": deployment.published_revision},
            queue_policy="reject",
            create_conversation=True,
            conversation_title=f"{deployment.name} 客服会话",
        ),
        current_user=user,
        db=db,
    )
    run_id = response.get("run_id")
    if response.get("status") == "rejected" or not run_id:
        raise HTTPException(status_code=409, detail="当前客服会话正在处理其他消息，请稍后重试")
    try:
        result = await asyncio.wait_for(
            await_agent_run_result(run_id=str(run_id), current_uid=str(user.uid)),
            timeout=PUBLIC_CHAT_TIMEOUT_SECONDS,
        )
    except (AgentRunWaitTimeout, TimeoutError) as exc:
        raise HTTPException(status_code=504, detail="客服暂未完成回复，请稍后使用同一幂等键查询") from exc
    if result.get("status") != "completed":
        raise HTTPException(status_code=502, detail="客服运行失败，请稍后重试")
    return {
        "answer": result.get("output") or "",
        "session_id": normalized_session,
        "request_id": request_id,
        "run_id": str(run_id),
        "status": "completed",
    }


def verify_bearer_token(authorization: str | None, expected_token_hash: str) -> bool:
    """使用常数时间比较验证 Webhook 和 MCP 凭据。"""
    if not authorization or not authorization.startswith("Bearer "):
        return False
    token = authorization[7:].strip()
    if not token:
        return False
    return hmac.compare_digest(_token_hash(token), expected_token_hash)
