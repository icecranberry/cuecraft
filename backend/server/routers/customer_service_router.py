"""客服配置、匿名分享、Webhook 与 MCP 的 HTTP 协议适配层。"""

from __future__ import annotations

from html import escape
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from yuxi.repositories.agent_repository import AgentRepository
from yuxi.repositories.customer_service_repository import CustomerServiceRepository
from yuxi.services.customer_service_service import (
    check_public_rate_limit,
    create_deployment,
    list_deployments,
    public_deployment,
    public_deployment_info,
    publish_deployment,
    require_deployment_mode,
    revoke_deployment,
    rotate_deployment_token,
    run_customer_service_test_message,
    run_public_customer_message,
    update_deployment_draft,
    verify_bearer_token,
)
from yuxi.storage.postgres.models_business import User

from server.utils.auth_middleware import get_db, get_required_user

customer_service = APIRouter(prefix="/customer-service", tags=["customer-service"])

MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_SUPPORTED_VERSIONS = {"2025-03-26", "2025-06-18", "2025-11-25"}


class DeploymentCreatePayload(BaseModel):
    """创建客服部署草稿。"""

    name: str = Field(default="", max_length=255)
    agent_slug: str = Field(min_length=1, max_length=80)


class DeploymentDraftPayload(DeploymentCreatePayload):
    """保存尚未发布的客服接入配置。"""

    modes: list[str] = Field(min_length=1, max_length=4)
    iframe_origins: list[str] = Field(default_factory=list, max_length=20)


class CustomerMessagePayload(BaseModel):
    """分享页或 Webhook 发送的客服消息。"""

    message: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=128)
    mode: str = Field(default="share", pattern="^(share|iframe)$")


class CustomerTestMessagePayload(BaseModel):
    """工作台客服测试消息。"""

    deployment_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=128)


class WebhookMessagePayload(BaseModel):
    """Webhook 入站消息。"""

    message: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=128)


def _client_ip(request: Request) -> str:
    """返回连接直接对端地址，避免信任未验证的转发头。"""
    return request.client.host if request.client else "unknown"


def _bearer_value(authorization: str | None) -> str:
    """从 Authorization header 中读取 Bearer token。"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="需要 Bearer 凭据")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="需要 Bearer 凭据")
    return token


def _mcp_json_response(
    payload: dict[str, Any],
    protocol_version: str = MCP_PROTOCOL_VERSION,
    status_code: int = 200,
) -> JSONResponse:
    """构造带 MCP 版本响应头的无状态 JSON-RPC 响应。"""
    return JSONResponse(payload, status_code=status_code, headers={"MCP-Protocol-Version": protocol_version})


@customer_service.get("/agents")
async def list_customer_service_agents(
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户可用于客服发布的主 Agent。"""
    agents = await AgentRepository(db).list_visible(user=current_user)
    return [{"slug": item.slug, "name": item.name, "description": item.description or ""} for item in agents]


@customer_service.get("/deployments")
async def get_customer_service_deployments(
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户的客服发布配置。"""
    return await list_deployments(db=db, uid=str(current_user.uid))


@customer_service.post("/deployments")
async def post_customer_service_deployment(
    payload: DeploymentCreatePayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """创建一份客服发布草稿。"""
    return await create_deployment(
        db=db,
        user=current_user,
        name=payload.name,
        agent_slug=payload.agent_slug,
    )


@customer_service.put("/deployments/{deployment_id}")
async def put_customer_service_deployment(
    deployment_id: str,
    payload: DeploymentDraftPayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """更新草稿 Agent、发布方式和 iframe 白名单。"""
    return await update_deployment_draft(
        db=db,
        user=current_user,
        deployment_id=deployment_id,
        name=payload.name,
        agent_slug=payload.agent_slug,
        modes=payload.modes,
        iframe_origins=payload.iframe_origins,
    )


@customer_service.post("/deployments/{deployment_id}/publish")
async def post_customer_service_publish(
    deployment_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """发布草稿 Agent 的固定配置快照。"""
    return await publish_deployment(db=db, user=current_user, deployment_id=deployment_id)


@customer_service.post("/deployments/{deployment_id}/rotate-token")
async def post_customer_service_rotate_token(
    deployment_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """轮换匿名分享与集成使用的 bearer token。"""
    return await rotate_deployment_token(db=db, uid=str(current_user.uid), deployment_id=deployment_id)


@customer_service.post("/deployments/{deployment_id}/revoke")
async def post_customer_service_revoke(
    deployment_id: str,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """撤销指定部署的所有公开入口。"""
    return await revoke_deployment(db=db, uid=str(current_user.uid), deployment_id=deployment_id)


@customer_service.post("/test/messages")
async def post_customer_service_test_message(
    payload: CustomerTestMessagePayload,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """以草稿 Agent 创建与外部访客隔离的客服测试 Run。"""
    deployment = await CustomerServiceRepository(db).get_for_owner(str(current_user.uid), payload.deployment_id)
    if deployment is None:
        raise HTTPException(status_code=404, detail="部署不存在")
    return await run_customer_service_test_message(
        db=db,
        user=current_user,
        deployment=deployment,
        message=payload.message,
        session_id=payload.session_id,
        idempotency_key=payload.idempotency_key,
    )


@customer_service.get("/public/{token}")
async def get_public_customer_service(
    token: str,
    mode: str = Query(default="share", pattern="^(share|iframe)$"),
    db: AsyncSession = Depends(get_db),
):
    """读取匿名客服分享页的公开名称和欢迎语。"""
    return await public_deployment_info(db=db, token=token, mode=mode)


@customer_service.post("/public/{token}/messages")
async def post_public_customer_service_message(
    token: str,
    payload: CustomerMessagePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """无需登录地调用已发布的客服 Agent。"""
    deployment = await public_deployment(db=db, token=token)
    require_deployment_mode(deployment, payload.mode)
    await check_public_rate_limit(deployment_id=deployment.id, client_ip=_client_ip(request))
    return await run_public_customer_message(
        db=db,
        deployment=deployment,
        message=payload.message,
        session_id=payload.session_id,
        idempotency_key=payload.idempotency_key,
        channel=payload.mode,
    )


@customer_service.get("/embed/{token}", response_class=HTMLResponse)
async def get_customer_service_embed(token: str, db: AsyncSession = Depends(get_db)):
    """返回受 iframe Origin 白名单约束的嵌入壳页面。"""
    deployment = await public_deployment(db=db, token=token)
    require_deployment_mode(deployment, "iframe")
    origins = " ".join(deployment.published_iframe_origins or [])
    ancestors = f"'self' {origins}".strip()
    html = (
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" "
        "content=\"width=device-width,initial-scale=1\"><style>html,body,iframe{margin:0;width:100%;"
        "height:100%;border:0;overflow:hidden}</style></head><body>"
        f"<iframe title=\"{escape(deployment.name[:120], quote=True)}\" src=\"/support/{token}?embed=1\"></iframe>"
        "</body></html>"
    )
    return HTMLResponse(
        html,
        headers={"Content-Security-Policy": f"frame-ancestors {ancestors}", "X-Content-Type-Options": "nosniff"},
    )


@customer_service.post("/webhook")
async def post_customer_service_webhook(
    payload: WebhookMessagePayload,
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """接收带 bearer 凭据和幂等键的 Webhook 入站消息。"""
    token = _bearer_value(authorization)
    deployment = await public_deployment(db=db, token=token)
    require_deployment_mode(deployment, "webhook")
    if not verify_bearer_token(authorization, str(deployment.public_token_hash)):
        raise HTTPException(status_code=401, detail="Webhook 凭据无效")
    await check_public_rate_limit(deployment_id=deployment.id, client_ip=_client_ip(request))
    return await run_public_customer_message(
        db=db,
        deployment=deployment,
        message=payload.message,
        session_id=payload.session_id,
        idempotency_key=payload.idempotency_key,
        channel="webhook",
    )


@customer_service.post("/mcp")
async def post_customer_service_mcp(
    payload: dict[str, Any],
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """以 Streamable HTTP JSON-RPC 暴露一个客服对话 MCP 工具。"""
    token = _bearer_value(authorization)
    deployment = await public_deployment(db=db, token=token)
    require_deployment_mode(deployment, "mcp")
    if not verify_bearer_token(authorization, str(deployment.public_token_hash)):
        raise HTTPException(status_code=401, detail="MCP 凭据无效")
    method = payload.get("method")
    request_id = payload.get("id")
    if payload.get("jsonrpc") != "2.0" or not isinstance(method, str):
        return _mcp_json_response(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32600, "message": "Invalid Request"},
            },
            status_code=400,
        )
    if method == "notifications/initialized" or (method.startswith("notifications/") and request_id is None):
        return Response(status_code=202)
    if method == "initialize":
        params = payload.get("params")
        requested_version = params.get("protocolVersion") if isinstance(params, dict) else None
        protocol_version = requested_version if requested_version in MCP_SUPPORTED_VERSIONS else MCP_PROTOCOL_VERSION
        result = {
            "protocolVersion": protocol_version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "Yuxi Customer Service", "version": "1.0.0"},
        }
        return _mcp_json_response({"jsonrpc": "2.0", "id": request_id, "result": result}, protocol_version)
    if method == "ping":
        return _mcp_json_response({"jsonrpc": "2.0", "id": request_id, "result": {}})
    if method == "tools/list":
        return _mcp_json_response(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "customer_service_chat",
                            "description": "向已发布的 Yuxi 智能客服发送一条客户消息并获得回复。",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "message": {"type": "string", "minLength": 1, "maxLength": 4000},
                                    "session_id": {"type": "string", "minLength": 1, "maxLength": 128},
                                    "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128},
                                },
                                "required": ["message", "session_id", "idempotency_key"],
                            },
                        }
                    ]
                },
            }
        )
    if method != "tools/call":
        return _mcp_json_response(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}},
            status_code=200,
        )

    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
    if params.get("name") != "customer_service_chat":
        return _mcp_json_response(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "Unknown tool"}},
        )
    try:
        await check_public_rate_limit(deployment_id=deployment.id, client_ip=_client_ip(request))
        result = await run_public_customer_message(
            db=db,
            deployment=deployment,
            message=str(arguments.get("message") or ""),
            session_id=str(arguments.get("session_id") or ""),
            idempotency_key=str(arguments.get("idempotency_key") or f"mcp-{request_id}"),
            channel="mcp",
        )
        text = result["answer"]
        is_error = False
    except HTTPException as exc:
        text = str(exc.detail)
        is_error = True
    return _mcp_json_response(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"content": [{"type": "text", "text": text}], "isError": is_error},
        }
    )
