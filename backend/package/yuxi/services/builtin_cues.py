"""供设计页与素材库共用的内置光杆示意规格。"""

from __future__ import annotations

from typing import Any


def _segment(
    segment_id: str,
    kind: str,
    name: str,
    start: float,
    end: float,
    radius_start: float,
    radius_end: float,
    material: str,
) -> dict[str, Any]:
    """构造连续杆段规格。"""
    return {
        "id": segment_id,
        "kind": kind,
        "name": name,
        "a0": start,
        "a1": end,
        "r0": radius_start,
        "r1": radius_end,
        "matPreset": material,
        "printEnabled": True,
    }


def _demo_parts(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """为分段示意杆生成只读拆解尺寸。"""
    return [
        {
            **segment,
            "length_mm": segment["a1"] - segment["a0"],
            "diameter_front_mm": segment["r0"] * 2,
            "diameter_back_mm": segment["r1"] * 2,
        }
        for segment in segments
    ]


NINEBALL_SEGMENTS = [
    _segment("shaft", "shaft", "前支（枫木）", 29, 737, 6.5, 10.7, "maple"),
    _segment("joint", "joint", "接头（中轮）", 737, 750, 10.7, 11, "stainless"),
    _segment("ring-joint", "ring", "接头装饰环", 750, 758, 11, 11.1, "brass"),
    _segment("butt-forearm", "butt", "后把前臂", 758, 1142, 11.1, 13.4, "maple"),
    _segment("ring-deco", "ring", "握把前装饰环", 1142, 1150, 13.4, 13.4, "brass"),
    _segment("grip", "grip", "握把（皮革缠面）", 1150, 1352, 13.4, 14.5, "leather"),
    _segment("butt-cap", "butt", "后把尾段（大轮）", 1352, 1474, 14.5, 15.7, "ebony"),
]

NINEBALL_RENDER_SEGMENTS = [
    _segment("tip", "tip", "皮头", 0, 5, 6.5, 6.5, "leather"),
    _segment("ferrule", "ring", "先角", 5, 29, 6.5, 6.5, "ivory"),
    *NINEBALL_SEGMENTS,
]

BRITISH_8_SEGMENTS = [
    _segment("shaft", "shaft", "前支（白蜡木）", 0, 1040, 4.2, 10.5, "maple"),
    _segment("butt", "butt", "后把（乌木）", 1040, 1450, 10.5, 14, "ebony"),
]

SNOOKER_SEGMENTS = [
    _segment("shaft", "shaft", "前支（白蜡木）", 0, 1090, 4.9, 10, "maple"),
    _segment("butt", "butt", "后把（仿乌木）", 1090, 1450, 10, 14, "ebony"),
]

TRAVEL_SEGMENTS = [
    _segment("shaft", "shaft", "前支", 0, 533.4, 6.5, 10.5, "maple"),
    _segment("forearm", "butt", "中段前臂", 533.4, 1016, 10.5, 13, "maple"),
    _segment("handle", "grip", "便携握把", 1016, 1473.2, 13, 15, "leather"),
]

BUILTIN_BLANK_ASSETS: list[dict[str, Any]] = [
    {
        "id": "builtin-cue-nineball",
        "kind": "blank",
        "source": "builtin",
        "name": "大头杆",
        "description": "沿用 yuxi 现有大头杆模型，包含完整的杆头、先角、杆身、接头、装饰环、握把及尾段拆解。",
        "tags": ["内置", "九球", "完整拆解"],
        "specification": {
            "cue_template_id": "nineball",
            "length_mm": 1474,
            "shaft_length_mm": 737,
            "tip_diameter_mm": 13,
            "joint_diameter_mm": 21.4,
            "butt_diameter_mm": 31.4,
            "segments": NINEBALL_RENDER_SEGMENTS,
            "display_parts": [
                {"id": "tip", "name": "皮头", "a": 0, "diameter_mm": 13, "length_mm": 5},
                {"id": "ferrule", "name": "先角", "a0": 5, "a1": 29, "diameter_mm": 13, "length_mm": 24},
                *_demo_parts(NINEBALL_SEGMENTS),
                {"id": "face-tip", "name": "皮头端面", "a": 0, "diameter_mm": 13, "length_mm": 0},
                {"id": "face-butt", "name": "端面（后把底）", "a": 1474, "diameter_mm": 31.4, "length_mm": 0},
            ],
            "size_status": "示意尺寸",
        },
    },
    {
        "id": "builtin-cue-english-eight",
        "kind": "blank",
        "source": "builtin",
        "name": "英式八球杆",
        "description": "两段式示意模型；外形比例参考公开的 57 英寸英式八球杆资料，非制造规格。",
        "tags": ["内置", "英式八球", "两段"],
        "specification": {
            "length_mm": 1450,
            "shaft_length_mm": 1040,
            "tip_diameter_mm": 8.3,
            "joint_diameter_mm": 21,
            "butt_diameter_mm": 28,
            "segments": BRITISH_8_SEGMENTS,
            "display_parts": _demo_parts(BRITISH_8_SEGMENTS),
            "size_status": "示意尺寸",
            "size_source": "参考 Peradon Comet 公开名义尺寸；其余几何参数为示意值。",
        },
    },
    {
        "id": "builtin-cue-snooker",
        "kind": "blank",
        "source": "builtin",
        "name": "斯诺克杆",
        "description": "两段式示意模型；外形比例参考公开的 57 英寸斯诺克杆资料，非制造规格。",
        "tags": ["内置", "斯诺克", "两段"],
        "specification": {
            "length_mm": 1450,
            "shaft_length_mm": 1090,
            "tip_diameter_mm": 9.8,
            "joint_diameter_mm": 20,
            "butt_diameter_mm": 28,
            "segments": SNOOKER_SEGMENTS,
            "display_parts": _demo_parts(SNOOKER_SEGMENTS),
            "size_status": "示意尺寸",
            "size_source": "参考 Peradon Spectre 公开名义尺寸；其余几何参数为示意值。",
        },
    },
    {
        "id": "builtin-cue-travel-three-piece",
        "kind": "blank",
        "source": "builtin",
        "name": "三段便携九球杆",
        "description": "三段式旅行杆示意模型；分段数量与杆长参考公开旅行杆资料，非制造规格。",
        "tags": ["内置", "九球", "三段", "便携"],
        "specification": {
            "length_mm": 1473.2,
            "shaft_length_mm": 533.4,
            "tip_diameter_mm": 12.7,
            "joint_diameter_mm": 21,
            "butt_diameter_mm": 30,
            "segments": TRAVEL_SEGMENTS,
            "display_parts": _demo_parts(TRAVEL_SEGMENTS),
            "size_status": "示意尺寸",
            "size_source": "参考 McDermott 58 英寸三段旅行杆公布的三件分段长度；其余几何参数为示意值。",
        },
    },
]

BUILTIN_BLANK_ASSET_IDS = {asset["id"] for asset in BUILTIN_BLANK_ASSETS}


def builtin_blank_asset_views(kind: str | None = None) -> list[dict[str, Any]]:
    """返回可设计光杆的内置目录投影。"""
    if kind not in (None, "blank"):
        return []
    return [
        {
            **asset,
            "width_px": 0,
            "height_px": 0,
            "has_image": False,
            "created_at": None,
        }
        for asset in BUILTIN_BLANK_ASSETS
    ]
