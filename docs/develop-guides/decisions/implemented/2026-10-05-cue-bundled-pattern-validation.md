# 保存作品接受内置花纹

状态：implemented
类型：bug-fix
Owner：`backend/package/yuxi/services/cue_service.py`

## 问题

设计器允许把随 Web 发布的内置花纹加入作品快照。它们使用稳定的 `builtin-<id>` 引用，不创建 `CueAsset` 数据库行；保存服务却把每个图层引用都当作数据库素材查询，导致保存返回 422。

## 决定

作品快照校验接受与前端内置花纹目录完全匹配的固定 ID。其他图层引用仍须对应数据库中类型为 `pattern` 或 `wrap` 的素材；未知 ID 和其他类型继续拒绝。内置花纹图片继续由 Web 静态资源提供，上传与 AI 生成的素材继续由 PostgreSQL 和 MinIO 管理。

不选择把每个内置素材复制成数据库记录，因为它会把固定应用资源重复保存为用户素材；也不接受任意 `builtin-` 前缀，因为那会允许作品引用不存在的素材。

## 后果与验证

前端新增或移除内置花纹时，必须同步更新后端允许的固定 ID。单元测试覆盖有效内置 ID 与未知 ID；本地目录核对确认后端 40 个 ID 与前端目录一致。`test/unit/test_cue_studio.py` 通过（11 项）。真实 HTTP 集成测试已补充，但因当前环境未配置 `TEST_USERNAME` / `TEST_PASSWORD` 而跳过；Ruff 在运行中的 API 容器内不可用。
