"""球杆方案顾问使用的内置领域工具。"""

from typing import Any

from fastapi import HTTPException
from langgraph.prebuilt.tool_node import ToolRuntime
from pydantic import BaseModel, Field

from yuxi.agents.toolkits.registry import tool
from yuxi.services.cue_proposal_service import catalog_for_proposals, save_proposals
from yuxi.storage.postgres.manager import pg_manager


class CueCatalogInput(BaseModel):
    """搜索单厂家 SKU 与共享素材。"""

    query: str = Field(default="", description="可选 SKU 编号或名称关键字")


@tool(category="buildin", tags=["球杆"], display_name="查询球杆目录", args_schema=CueCatalogInput)
async def cue_catalog(runtime: ToolRuntime, query: str = "") -> dict[str, Any]:
    """为当前登录用户查询可用于方案的真实目录。"""
    if not getattr(getattr(runtime, "context", None), "uid", None):
        return {"error": "缺少用户身份"}
    async with pg_manager.get_async_session_context() as session:
        return await catalog_for_proposals(session, query)


class CueSaveProposalsInput(BaseModel):
    """三套球杆候选的结构化输入。"""

    request_text: str = Field(description="用户原始设计需求")
    variants: list[dict[str, Any]] = Field(
        description="恰好三套方案；每套含 title、reason、可选 sku_code、blank_asset_id、part_overrides、layers"
    )


@tool(category="buildin", tags=["球杆"], display_name="保存球杆方案", args_schema=CueSaveProposalsInput)
async def cue_save_proposals(request_text: str, variants: list[dict[str, Any]], runtime: ToolRuntime) -> dict[str, Any]:
    """校验真实 SKU 与素材引用并保存当前用户的三套方案。"""
    uid = str(getattr(getattr(runtime, "context", None), "uid", "") or "")
    if not uid:
        return {"error": "缺少用户身份"}
    try:
        async with pg_manager.get_async_session_context() as session:
            saved = await save_proposals(db=session, uid=uid, request_text=request_text, variants=variants)
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    return {
        "proposal_id": saved["id"],
        "variants": [
            {
                "title": item["title"],
                "reason": item["reason"],
                "preview_url": f"/cue/works?proposal={saved['id']}&variant={index}",
                "edit_url": f"/cue/design?proposal={saved['id']}&variant={index}",
            }
            for index, item in enumerate(saved["variants"])
        ],
    }
