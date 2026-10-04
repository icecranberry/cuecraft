"""球杆业务的 PostgreSQL 可见性与写入边界。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.storage.postgres.models_business import (
    CueAsset,
    CueDesign,
    CueDesignShare,
    CueDesignVersion,
    CueProposal,
    CueSku,
    CueWorkAssistant,
)


class CueRepository:
    """按用户边界读写素材、作品、方案和 SKU。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_assets(self, kind: str | None = None) -> list[CueAsset]:
        """返回所有用户可用的共享素材。"""
        query = select(CueAsset)
        if kind:
            query = query.where(CueAsset.kind == kind)
        return list((await self.db.scalars(query.order_by(CueAsset.created_at.desc()))).all())

    async def get_asset(self, asset_id: str) -> CueAsset | None:
        """按素材 ID 读取共享素材。"""
        return await self.db.get(CueAsset, asset_id)

    async def add_asset(self, asset: CueAsset) -> CueAsset:
        """将经校验的素材加入当前事务。"""
        self.db.add(asset)
        await self.db.flush()
        return asset

    async def list_designs(self, uid: str) -> list[CueDesign]:
        """只返回当前用户的作品。"""
        query = select(CueDesign).where(CueDesign.owner_uid == uid).order_by(CueDesign.updated_at.desc())
        return list((await self.db.scalars(query)).all())

    async def get_design(self, uid: str, design_id: str) -> CueDesign | None:
        """按所有者读取作品。"""
        query = select(CueDesign).where(CueDesign.id == design_id, CueDesign.owner_uid == uid)
        return (await self.db.scalars(query)).one_or_none()

    async def add_design(self, design: CueDesign, version: CueDesignVersion) -> CueDesign:
        """同一事务保存作品与首个版本。"""
        self.db.add_all((design, version))
        await self.db.flush()
        return design

    async def add_version(self, version: CueDesignVersion) -> None:
        """在当前事务中添加不可变作品版本。"""
        self.db.add(version)
        await self.db.flush()

    async def list_versions(self, design_id: str) -> list[CueDesignVersion]:
        """列出作品历史快照。"""
        query = select(CueDesignVersion).where(CueDesignVersion.design_id == design_id)
        return list((await self.db.scalars(query.order_by(CueDesignVersion.version.desc()))).all())

    async def get_design_version(self, design_id: str, version: int) -> CueDesignVersion | None:
        """读取作品的指定不可变版本。"""
        query = select(CueDesignVersion).where(
            CueDesignVersion.design_id == design_id,
            CueDesignVersion.version == version,
        )
        return (await self.db.scalars(query)).one_or_none()

    async def list_design_shares(self, uid: str, design_id: str) -> list[CueDesignShare]:
        """列出当前用户作品的分享凭据。"""
        query = select(CueDesignShare).where(
            CueDesignShare.owner_uid == uid,
            CueDesignShare.design_id == design_id,
        )
        return list((await self.db.scalars(query.order_by(CueDesignShare.created_at.desc()))).all())

    async def get_design_share(self, uid: str, design_id: str, share_id: str) -> CueDesignShare | None:
        """按所有者读取单个分享凭据。"""
        query = select(CueDesignShare).where(
            CueDesignShare.id == share_id,
            CueDesignShare.owner_uid == uid,
            CueDesignShare.design_id == design_id,
        )
        return (await self.db.scalars(query)).one_or_none()

    async def get_active_share_by_token_hash(self, token_hash: str) -> CueDesignShare | None:
        """通过 token 摘要查找仍有效的公开分享。"""
        query = select(CueDesignShare).where(
            CueDesignShare.token_hash == token_hash,
            CueDesignShare.revoked_at.is_(None),
        )
        return (await self.db.scalars(query)).one_or_none()

    async def get_work_assistant(self, uid: str, design_id: str) -> CueWorkAssistant | None:
        """读取当前用户与作品唯一对应的 AI 历史。"""
        query = select(CueWorkAssistant).where(
            CueWorkAssistant.owner_uid == uid,
            CueWorkAssistant.design_id == design_id,
        )
        return (await self.db.scalars(query)).one_or_none()

    async def add_work_assistant(self, assistant: CueWorkAssistant) -> CueWorkAssistant:
        """创建当前用户的作品 AI 历史。"""
        self.db.add(assistant)
        await self.db.flush()
        return assistant

    async def list_skus(self, query: str = "") -> list[CueSku]:
        """按编号或名称查询单厂家目录。"""
        stmt = select(CueSku)
        if query:
            pattern = f"%{query}%"
            stmt = stmt.where(CueSku.code.ilike(pattern) | CueSku.name.ilike(pattern))
        return list((await self.db.scalars(stmt.order_by(CueSku.code).limit(500))).all())

    async def get_sku(self, code: str) -> CueSku | None:
        """按厂家 SKU 编号读取目录项。"""
        return await self.db.get(CueSku, code)

    async def add_proposal(self, proposal: CueProposal) -> CueProposal:
        """持久化当前用户的三套方案。"""
        self.db.add(proposal)
        await self.db.flush()
        return proposal

    async def get_proposal(self, uid: str, proposal_id: str) -> CueProposal | None:
        """按所有者读取方案集。"""
        query = select(CueProposal).where(CueProposal.id == proposal_id, CueProposal.owner_uid == uid)
        return (await self.db.scalars(query)).one_or_none()
