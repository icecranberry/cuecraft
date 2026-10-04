"""客服部署的 PostgreSQL 读写边界。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.storage.postgres.models_business import CustomerServiceDeployment


class CustomerServiceRepository:
    """按部署所有者和公开凭据读取客服配置。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_for_owner(self, uid: str) -> list[CustomerServiceDeployment]:
        """列出当前用户的发布配置。"""
        query = select(CustomerServiceDeployment).where(CustomerServiceDeployment.owner_uid == uid)
        return list((await self.db.scalars(query.order_by(CustomerServiceDeployment.updated_at.desc()))).all())

    async def get_for_owner(self, uid: str, deployment_id: str, *, for_update: bool = False):
        """按所有者读取一个客服部署。"""
        query = select(CustomerServiceDeployment).where(
            CustomerServiceDeployment.id == deployment_id,
            CustomerServiceDeployment.owner_uid == uid,
        )
        if for_update:
            query = query.with_for_update()
        return (await self.db.scalars(query)).one_or_none()

    async def get_active_by_token_hash(self, token_hash: str):
        """只读取凭据有效且已发布的客服部署。"""
        query = select(CustomerServiceDeployment).where(
            CustomerServiceDeployment.public_token_hash == token_hash,
            CustomerServiceDeployment.revoked_at.is_(None),
            CustomerServiceDeployment.published_agent_slug.is_not(None),
            CustomerServiceDeployment.published_at.is_not(None),
        )
        return (await self.db.scalars(query)).one_or_none()
